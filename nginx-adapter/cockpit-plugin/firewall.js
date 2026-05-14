/* Server Monitor — Firewall Management (ufw, nginx 어댑터 환경 Ubuntu) */
/* Depends on: utils.js (SM namespace) */

(function() {
    "use strict";

    if (!window.SM) { console.error("SM not loaded"); return; }

    var $ = SM.$;
    var Validate = SM.Validate;
    var PROTECTED_PORTS = SM.PROTECTED_PORTS || [19999, 3011, 9090, 22, 80, 443];

    /* ══════════════════════════════════════
       ufw 상태 + 규칙 목록
       ══════════════════════════════════════ */

    function loadFirewallStatus() {
        var portsContainer = $("fw-port-list");
        var svcsContainer = $("fw-service-list");
        var zoneInfo = $("fw-zone-info");
        if (!portsContainer || !svcsContainer) return;
        if (zoneInfo) zoneInfo.textContent = "ufw (Ubuntu)";

        portsContainer.innerHTML = '<div class="muted loading">Loading...</div>';
        svcsContainer.innerHTML = '<div class="muted">ufw는 service 단위 미지원 (systemd-based 서비스명만 사용). 포트 또는 IP 화이트리스트 단위로 관리합니다.</div>';

        cockpit.spawn(["ufw", "status", "numbered"], { superuser: "require" })
            .then(function(output) { renderUfwRules(output, portsContainer); })
            .fail(function(err) {
                portsContainer.innerHTML = '<div class="result-box result-error">' + SM.escapeHtml(SM.errMsg(err)) + '</div>';
            });
    }

    function renderUfwRules(output, container) {
        // ufw status numbered 출력 형태:
        //      To                         Action      From
        //      --                         ------      ----
        // [ 1] 22/tcp                     ALLOW IN    198.51.100.10             # SSH from office VPN
        // [ 2] 80/tcp                     ALLOW IN    Anywhere
        var lines = output.split("\n");
        var statusLine = lines.find(function(l) { return l.indexOf("Status:") === 0; });
        var defLine = lines.find(function(l) { return l.indexOf("Default:") === 0; });
        var rules = [];
        lines.forEach(function(line) {
            var m = line.match(/^\[\s*(\d+)\]\s+(\S+)\s+(ALLOW|DENY|REJECT|LIMIT)(?:\s+IN|\s+OUT|\s+FWD)?\s+(.+?)(?:\s+#\s*(.+))?$/);
            if (m) {
                rules.push({
                    num: m[1],
                    to: m[2],
                    action: m[3],
                    from: m[4].trim(),
                    comment: m[5] || ""
                });
            }
        });

        var html = '<div class="muted" style="font-size:0.75rem;margin-bottom:0.4rem">' +
            SM.escapeHtml(statusLine || "") + ' / ' + SM.escapeHtml(defLine || "") +
            '</div>';
        if (rules.length === 0) {
            html += '<div class="muted">No rules</div>';
            container.innerHTML = html;
            return;
        }
        html += '<table class="mgmt-table"><thead><tr><th>#</th><th>To</th><th>Action</th><th>From</th><th>Comment</th><th>Action</th></tr></thead><tbody>';
        rules.forEach(function(r) {
            // PROTECTED 포트 보호 (delete 버튼 없음)
            var portNum = parseInt(r.to);
            var isProtected = !isNaN(portNum) && PROTECTED_PORTS.indexOf(portNum) !== -1;
            var actBadge = r.action === "ALLOW" ? '<span class="badge badge-ok">' + r.action + '</span>'
                : r.action === "DENY" ? '<span class="badge badge-crit">' + r.action + '</span>'
                : '<span class="badge badge-warn">' + r.action + '</span>';
            var actions = isProtected
                ? '<span class="badge badge-warn">protected</span>'
                : '<button class="btn btn-sm btn-danger" data-ufw-delete="' + SM.escapeHtml(r.num) + '">Delete</button>';
            html += '<tr><td><code>' + SM.escapeHtml(r.num) + '</code></td>' +
                '<td><code>' + SM.escapeHtml(r.to) + '</code></td>' +
                '<td>' + actBadge + '</td>' +
                '<td><code>' + SM.escapeHtml(r.from) + '</code></td>' +
                '<td>' + SM.escapeHtml(r.comment) + '</td>' +
                '<td>' + actions + '</td></tr>';
        });
        container.innerHTML = html + '</tbody></table>';

        container.querySelectorAll("[data-ufw-delete]").forEach(function(btn) {
            btn.addEventListener("click", function() {
                deleteUfwRule(btn.getAttribute("data-ufw-delete"));
            });
        });
    }

    /* ══════════════════════════════════════
       Add Port (옵션: From IP)
       ══════════════════════════════════════ */

    function addPort() {
        SM.clearErrors("fw-port");
        var port = ($("fw-port-input") || {}).value || "";
        var proto = ($("fw-proto-select") || {}).value || "tcp";
        var btn = $("fw-port-submit");
        port = port.trim();

        var portNum = parseInt(port, 10);
        if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
            SM.showError("fw-port-input-error", "Port must be 1-65535");
            return;
        }

        // 옵션: from IP (svc 입력란을 재활용)
        var fromIp = (($("fw-svc-input") || {}).value || "").trim();
        var rule = "ufw allow ";
        var ruleSpec;
        if (fromIp) {
            // 단순 검증: IP 또는 CIDR
            if (!/^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/.test(fromIp)) {
                SM.showError("fw-port-input-error", "Invalid IP: " + fromIp);
                return;
            }
            ruleSpec = ["from", fromIp, "to", "any", "port", String(portNum), "proto", proto];
            rule += "from " + fromIp + " to any port " + portNum + " proto " + proto;
        } else {
            ruleSpec = [String(portNum) + "/" + proto];
            rule += portNum + "/" + proto;
        }

        SM.confirmDialog("Add ufw rule", rule + (fromIp ? "" : " (Anywhere)"))
            .then(function(ok) {
                if (!ok) return;
                SM.setLoading(btn, true);
                cockpit.spawn(["ufw", "allow"].concat(ruleSpec), { superuser: "require" })
                    .then(function(out) {
                        SM.setLoading(btn, false);
                        SM.logAction("UFW_ALLOW", rule);
                        SM.showResult("fw-result", true, out.trim() || "Rule added");
                        var p = $("fw-port-input"); if (p) p.value = "";
                        var s = $("fw-svc-input"); if (s) s.value = "";
                        loadFirewallStatus();
                    })
                    .fail(function(err) {
                        SM.setLoading(btn, false);
                        SM.showResult("fw-result", false, "Failed: " + SM.errMsg(err));
                    });
            });
    }

    function deleteUfwRule(num) {
        SM.confirmDialog("Delete ufw rule",
            "Rule #" + num + "\n\nWARNING: 규칙 번호가 변경됨. 의존된 규칙이 있으면 영향 가능.")
            .then(function(ok) {
                if (!ok) return;
                cockpit.spawn(["sh", "-c", "echo y | ufw delete " + num], { superuser: "require" })
                    .then(function(out) {
                        SM.logAction("UFW_DELETE", "rule#" + num);
                        SM.showResult("fw-result", true, out.trim() || "Rule deleted");
                        loadFirewallStatus();
                    })
                    .fail(function(err) {
                        SM.showResult("fw-result", false, "Failed: " + SM.errMsg(err));
                    });
            });
    }

    /* ══════════════════════════════════════
       Initialization
       ══════════════════════════════════════ */

    function initFirewall() {
        loadFirewallStatus();
        SM.bindClick("fw-refresh", loadFirewallStatus);
        SM.bindSubmit("fw-port-form", addPort);
        // svc form은 비활성 — ufw는 service 명을 직접 받지 않음. From IP 입력란으로 재활용.
        var svcLabel = document.querySelector('label[for="fw-svc-input"]');
        var svcInput = $("fw-svc-input");
        if (svcInput) svcInput.placeholder = "From IP (optional, e.g. 198.51.100.10 or 10.0.0.0/24)";
        var svcSubmit = $("fw-svc-submit");
        if (svcSubmit) svcSubmit.style.display = "none";
    }

    SM.registerModule("firewall", initFirewall);

})();
