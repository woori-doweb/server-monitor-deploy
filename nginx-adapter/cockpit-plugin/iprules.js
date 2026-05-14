/* Server Monitor - IP Rules per Domain */
/* Depends on: utils.js (SM namespace, typedConfirmDialog) */

(function() {
    "use strict";

    if (!window.SM) { console.error("SM not loaded"); return; }

    var $ = SM.$;
    var IPRULE_CMD = "/usr/local/bin/server-monitor-iprule";
    var domains = [];

    function loadIpRules() {
        var c = $("ip-rules-list");
        if (!c) return;
        c.innerHTML = '<div class="muted loading">Loading...</div>';
        cockpit.spawn([IPRULE_CMD, "list"], { superuser: "require" })
            .then(function(out) {
                domains = out.trim().split("\n").filter(function(l) { return l.trim(); }).map(function(l) {
                    var p = l.split("\t");
                    return { name: p[0], mode: p[1] || "?", protected: p[2] === "true" };
                });
                renderTable(c);
            })
            .fail(function(err) {
                c.innerHTML = '<div class="result-box result-error">Failed: ' + SM.escapeHtml(SM.errMsg(err)) + '</div>';
            });
    }

    function renderTable(c) {
        if (domains.length === 0) { c.innerHTML = '<div class="muted">No managed domains</div>'; return; }
        var html = '<table class="mgmt-table"><thead><tr>' +
            '<th>Domain</th><th>Mode</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
        domains.forEach(function(d) {
            var modeBadge = d.mode === "public"
                ? '<span class="badge badge-ok">public</span>'
                : d.mode === "whitelist"
                  ? '<span class="badge badge-warn">whitelist</span>'
                  : '<span class="badge badge-inactive">' + SM.escapeHtml(d.mode) + '</span>';
            var statusBadge = d.protected
                ? '<span class="badge badge-crit">PROTECTED</span>'
                : '<span class="badge badge-inactive">editable</span>';
            var actions = d.protected
                ? '<button class="btn btn-sm" data-iprule-view="' + SM.escapeHtml(d.name) + '">View</button>'
                : '<button class="btn btn-sm" data-iprule-edit="' + SM.escapeHtml(d.name) + '">Edit</button>';
            html += '<tr><td><code>' + SM.escapeHtml(d.name) + '</code></td>' +
                '<td>' + modeBadge + '</td>' +
                '<td>' + statusBadge + '</td>' +
                '<td>' + actions + '</td></tr>';
        });
        c.innerHTML = html + '</tbody></table>';
        c.querySelectorAll("[data-iprule-edit]").forEach(function(b) {
            b.addEventListener("click", function() { editDomain(b.getAttribute("data-iprule-edit"), false); });
        });
        c.querySelectorAll("[data-iprule-view]").forEach(function(b) {
            b.addEventListener("click", function() { editDomain(b.getAttribute("data-iprule-view"), true); });
        });
    }

    function editDomain(domain, viewOnly) {
        var panel = $("ip-rule-edit-panel");
        var content = $("ip-rule-edit-content");
        var title = $("ip-rule-edit-title");
        if (!panel || !content) return;
        panel.style.display = "block";
        title.textContent = (viewOnly ? "View — " : "Edit — ") + domain;
        content.innerHTML = '<div class="muted loading">Loading...</div>';

        cockpit.spawn([IPRULE_CMD, "get", domain], { superuser: "require" })
            .then(function(out) { renderEdit(content, domain, out, viewOnly); })
            .fail(function(err) {
                content.innerHTML = '<div class="result-box result-error">' + SM.escapeHtml(SM.errMsg(err)) + '</div>';
            });
    }

    function parseMode(conf) {
        var m = conf.match(/^# MODE=(\w+)/m);
        return m ? m[1] : "public";
    }

    function parseIps(conf) {
        var ips = [];
        var re = /^\s*Require ip\s+(.+)$/gm;
        var m;
        while ((m = re.exec(conf)) !== null) {
            m[1].trim().split(/\s+/).forEach(function(ip) { if (ip) ips.push(ip); });
        }
        return ips;
    }

    function renderEdit(content, domain, conf, viewOnly) {
        var mode = parseMode(conf);
        var ips = parseIps(conf);
        if (viewOnly) {
            content.innerHTML = '<pre style="white-space:pre-wrap;font-size:0.7rem;background:#0f1117;padding:0.5rem;border-radius:4px;color:#d1d5db">' +
                SM.escapeHtml(conf) + '</pre>';
            return;
        }
        var html = '<div class="form-row">' +
            '<div class="form-group">' +
              '<label class="form-label">Mode</label>' +
              '<select id="ip-rule-mode" class="form-select">' +
                '<option value="public"' + (mode === "public" ? " selected" : "") + '>Public (모든 IP 허용)</option>' +
                '<option value="whitelist"' + (mode === "whitelist" ? " selected" : "") + '>Whitelist (특정 IP만 허용)</option>' +
              '</select>' +
            '</div></div>' +
            '<div class="form-group" id="ip-rule-ips-group">' +
              '<label class="form-label">IPs / CIDR (한 줄에 하나)</label>' +
              '<textarea id="ip-rule-ips" class="form-textarea" rows="6" placeholder="198.51.100.10&#10;127.0.0.1&#10;192.168.1.0/24">' +
                SM.escapeHtml(ips.join("\n")) +
              '</textarea>' +
              '<span class="form-error" id="ip-rule-ips-error"></span>' +
              '<p class="muted" style="font-size:0.7rem;margin-top:0.25rem">' +
                'IPv4 / IPv4 CIDR / IPv6 / IPv6 CIDR 모두 지원. Apache <code>Require ip</code> 직접 사용.' +
              '</p>' +
            '</div>' +
            '<div style="margin-top:0.5rem">' +
              '<button class="btn btn-danger" id="ip-rule-apply">Apply</button> ' +
              '<button class="btn" id="ip-rule-cancel">Cancel</button>' +
            '</div>' +
            '<div id="ip-rule-result" style="margin-top:0.5rem"></div>';
        content.innerHTML = html;

        function syncVis() {
            var m = ($("ip-rule-mode") || {}).value;
            var g = $("ip-rule-ips-group");
            if (g) g.style.display = (m === "whitelist") ? "" : "none";
        }
        $("ip-rule-mode").addEventListener("change", syncVis);
        syncVis();

        $("ip-rule-apply").addEventListener("click", function() { applyRule(domain); });
        $("ip-rule-cancel").addEventListener("click", function() {
            var p = $("ip-rule-edit-panel"); if (p) p.style.display = "none";
        });
    }

    function applyRule(domain) {
        SM.clearErrors("ip-rule");
        var mode = $("ip-rule-mode").value;
        var ipsRaw = ($("ip-rule-ips") || {}).value || "";
        var ips = ipsRaw.split(/\n+/).map(function(s) { return s.trim(); }).filter(function(s) { return s; });

        if (mode === "whitelist" && ips.length === 0) {
            SM.showError("ip-rule-ips-error", "Whitelist 모드는 최소 1개 IP 필요");
            return;
        }
        var bad = ips.filter(function(ip) { return !/^[0-9a-fA-F:.]+(\/\d{1,3})?$/.test(ip) || ip.length > 64; });
        if (bad.length) {
            SM.showError("ip-rule-ips-error", "올바르지 않은 IP/CIDR: " + bad.join(", "));
            return;
        }

        SM.typedConfirmDialog("Apply IP Rule",
            "Domain: " + domain + "\n" +
            "Mode: " + mode + "\n" +
            (mode === "whitelist" ? "IPs: " + ips.join(", ") + "\n\n" : "\n") +
            "잘못된 IP를 입력하면 본인이 즉시 차단될 수 있습니다.\n" +
            "복구는 SSH 통해 /etc/httpd/conf.d/iprules.d/" + domain + ".conf.bak.<ts> 백업에서.",
            domain)
            .then(function(ok) {
                if (!ok) return;
                var args = [IPRULE_CMD, "set", domain, mode].concat(ips);
                cockpit.spawn(args, { superuser: "require" })
                    .then(function(out) {
                        SM.logAction("IPRULE_SET", domain + " mode=" + mode + " ips=" + ips.length);
                        SM.showResult("ip-rule-result", true, out.trim());
                        loadIpRules();
                    })
                    .fail(function(err) {
                        SM.showResult("ip-rule-result", false, "Failed: " + SM.errMsg(err));
                    });
            });
    }

    function initIpRules() {
        loadIpRules();
        SM.bindClick("ip-rules-refresh", loadIpRules);
        SM.bindClick("ip-rule-edit-close", function() {
            var p = $("ip-rule-edit-panel"); if (p) p.style.display = "none";
        });
    }

    SM.registerModule("ip-rules", initIpRules);

})();
