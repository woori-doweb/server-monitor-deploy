/* Server Monitor - Service Management (systemd) */
/* Depends on: utils.js (SM namespace) */

(function() {
    "use strict";

    if (!window.SM) { console.error("SM not loaded"); return; }

    var $ = SM.$;
    // workstation 워크스테이션 (Ubuntu 22.04) 관리 서비스
    var WHITELIST = [
        { name: "tailscaled", label: "Tailscale daemon" },
        { name: "netdata", label: "Netdata" },
        { name: "pm2-monitor", label: "PM2 (Uptime Kuma)" },
        { name: "cockpit.socket", label: "Cockpit" },
        { name: "docker", label: "Docker" },
        { name: "ufw", label: "ufw (firewall)" },
        { name: "fail2ban", label: "fail2ban" },
        { name: "ssh", label: "SSH" },
        { name: "cron", label: "Cron" },
        { name: "lightdm", label: "Display Manager (GNOME)" },
        { name: "xrdp", label: "xrdp" },
        { name: "cups", label: "CUPS (printing)" },
        { name: "apparmor", label: "AppArmor" },
        { name: "packagekit", label: "PackageKit" }
    ];
    var NO_DISABLE = SM.PROTECTED_SERVICES || ["ssh", "ufw", "tailscaled", "pm2-monitor", "lightdm"];
    var WARN_STOP = ["ssh", "ufw", "tailscaled", "docker", "lightdm", "pm2-monitor"];

    /* ══════════════════════════════════════
       Service List
       ══════════════════════════════════════ */

    function loadServices() {
        var container = $("svc-mgmt-list");
        if (!container) return;
        container.innerHTML = '<div class="muted loading">Loading...</div>';

        var results = [];
        var pending = WHITELIST.length;

        function checkDone() {
            if (--pending > 0) return;
            // 보조 서버: PM2 미사용 → 직접 렌더
            renderServiceTable(results, container);
        }

        WHITELIST.forEach(function(svc) {
            var r = { name: svc.name, label: svc.label, active: "unknown", enabled: "unknown" };
            cockpit.spawn(["systemctl", "is-active", svc.name])
                .then(function(out) { r.active = out.trim(); })
                .fail(function() { r.active = "inactive"; })
                .always(function() {
                    cockpit.spawn(["systemctl", "is-enabled", svc.name])
                        .then(function(out) { r.enabled = out.trim(); })
                        .fail(function() { r.enabled = "disabled"; })
                        .always(function() { results.push(r); checkDone(); });
                });
        });
    }

    function addPm2Services(callback) {
        cockpit.spawn(["sh", "-c", "systemctl list-units --type=service --no-legend | grep '^pm2-' | awk '{print $1}'"])
            .then(function(output) {
                var units = output.trim().split("\n").filter(function(u) { return u; });
                if (units.length === 0) { callback([]); return; }
                var pm2results = [];
                var pending = units.length;
                units.forEach(function(unit) {
                    var r = { name: unit, label: "PM2: " + unit.replace("pm2-", "").replace(".service", ""), active: "unknown", enabled: "unknown" };
                    cockpit.spawn(["systemctl", "is-active", unit])
                        .then(function(out) { r.active = out.trim(); })
                        .fail(function() { r.active = "inactive"; })
                        .always(function() {
                            cockpit.spawn(["systemctl", "is-enabled", unit])
                                .then(function(out) { r.enabled = out.trim(); })
                                .fail(function() { r.enabled = "disabled"; })
                                .always(function() { pm2results.push(r); if (--pending <= 0) callback(pm2results); });
                        });
                });
            })
            .fail(function() { callback([]); });
    }

    function renderServiceTable(services, container) {
        if (services.length === 0) {
            container.innerHTML = '<div class="muted">No services found</div>';
            return;
        }
        var html = '<table class="mgmt-table"><thead><tr><th>Service</th><th>Unit</th><th>Status</th><th>Boot</th><th>Actions</th></tr></thead><tbody>';
        services.forEach(function(s) {
            var activeBadge = (s.active === "active" || s.active === "waiting")
                ? '<span class="badge badge-ok">active</span>'
                : s.active === "failed"
                    ? '<span class="badge badge-crit">failed</span>'
                    : '<span class="badge badge-inactive">' + SM.escapeHtml(s.active) + '</span>';

            var enabledBadge = s.enabled === "enabled"
                ? '<span class="badge badge-ok">enabled</span>'
                : '<span class="badge badge-inactive">' + SM.escapeHtml(s.enabled) + '</span>';

            var canDisable = NO_DISABLE.indexOf(s.name) === -1;
            var actions = '<button class="btn btn-sm" data-svc-action="restart" data-svc-name="' + SM.escapeHtml(s.name) + '">Restart</button> ';
            if (s.active === "active" || s.active === "waiting") {
                actions += '<button class="btn btn-sm" data-svc-action="stop" data-svc-name="' + SM.escapeHtml(s.name) + '">Stop</button> ';
            } else {
                actions += '<button class="btn btn-sm" data-svc-action="start" data-svc-name="' + SM.escapeHtml(s.name) + '">Start</button> ';
            }
            if (canDisable) {
                if (s.enabled === "enabled") {
                    actions += '<button class="btn btn-sm" data-svc-action="disable" data-svc-name="' + SM.escapeHtml(s.name) + '">Disable</button> ';
                } else {
                    actions += '<button class="btn btn-sm" data-svc-action="enable" data-svc-name="' + SM.escapeHtml(s.name) + '">Enable</button> ';
                }
            }
            actions += '<button class="btn btn-sm" data-svc-journal="' + SM.escapeHtml(s.name) + '">Journal</button>';

            html += '<tr><td>' + SM.escapeHtml(s.label) + '</td><td><code>' + SM.escapeHtml(s.name) + '</code></td>' +
                '<td>' + activeBadge + '</td><td>' + enabledBadge + '</td><td>' + actions + '</td></tr>';
        });
        container.innerHTML = html + '</tbody></table>';

        container.querySelectorAll("[data-svc-action]").forEach(function(btn) {
            btn.addEventListener("click", function() {
                controlService(btn.getAttribute("data-svc-name"), btn.getAttribute("data-svc-action"));
            });
        });
        container.querySelectorAll("[data-svc-journal]").forEach(function(btn) {
            btn.addEventListener("click", function() {
                viewJournal(btn.getAttribute("data-svc-journal"));
            });
        });
    }

    /* ══════════════════════════════════════
       Service Control
       ══════════════════════════════════════ */

    function controlService(name, action) {
        var critical = WARN_STOP.indexOf(name) !== -1;
        var needsTyped = critical && action === "stop";
        var needsWarn = critical && (action === "stop" || action === "restart");

        function execute() {
            cockpit.spawn(["systemctl", action, name], { superuser: "require" })
                .then(function() {
                    SM.logAction("SVC_" + action.toUpperCase(), name);
                    SM.showResult("svc-result", true, name + ": " + action + " OK");
                    loadServices();
                })
                .fail(function(err) {
                    SM.showResult("svc-result", false, name + " " + action + " failed: " + SM.errMsg(err));
                });
        }

        if (needsTyped) {
            // 핵심 서비스 stop — 이름 직접 입력 확인 (DROP 패턴)
            // 메인 서버 사고(2026-05-05 httpd stop)와 동일 패턴 mirror
            SM.typedConfirmDialog("Stop Critical Service",
                "Service: " + name + "\n\n" +
                "이 서비스를 stop하면 호스팅 사이트·운영 컨테이너에 즉시 영향이 발생합니다.\n" +
                "재시작 시 권한·SELinux·AppArmor 정책 정합성 문제로 시작 실패할 위험이 있어\n" +
                "운영 시간에는 신중히 결정하세요.",
                name)
                .then(function(ok) { if (ok) execute(); });
            return;
        }

        var msg = "Service: " + name + "\nAction: " + action;
        if (needsWarn) msg += "\n\nWARNING: " + (action === "restart" ? "잠시 다운타임 발생" : "사이트 영향 가능") + ".";
        SM.confirmDialog("Service " + action, msg)
            .then(function(ok) { if (ok) execute(); });
    }

    /* ══════════════════════════════════════
       Journal Viewer
       ══════════════════════════════════════ */

    function viewJournal(name) {
        var panel = $("svc-journal-panel");
        var content = $("svc-journal-content");
        var title = $("svc-journal-title");
        if (!panel || !content) return;

        panel.style.display = "block";
        title.textContent = "Journal: " + name;
        content.innerHTML = '<div class="muted loading">Loading...</div>';

        cockpit.spawn(["journalctl", "-u", name, "-n", "50", "--no-pager", "-o", "short-iso"], { superuser: "require" })
            .then(function(output) {
                if (!output.trim()) {
                    content.innerHTML = '<div class="muted">No journal entries</div>';
                    return;
                }
                content.innerHTML = '<pre class="log-output">' + SM.escapeHtml(output.trim()) + '</pre>';
            })
            .fail(function(err) {
                content.innerHTML = '<div class="result-box result-error">' + SM.escapeHtml(SM.errMsg(err)) + '</div>';
            });
    }

    /* ══════════════════════════════════════
       Initialization
       ══════════════════════════════════════ */

    function initServices() {
        loadServices();
        SM.bindClick("svc-refresh", loadServices);
        SM.bindClick("svc-journal-close", function() {
            var panel = $("svc-journal-panel");
            if (panel) panel.style.display = "none";
        });
    }

    SM.registerModule("services", initServices);

})();
