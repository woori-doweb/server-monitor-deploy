/* Server Monitor - Log Viewer */
/* Depends on: utils.js (SM namespace) */

(function() {
    "use strict";

    if (!window.SM) { console.error("SM not loaded"); return; }

    var $ = SM.$;
    var autoRefreshTimer = null;

    // workstation 워크스테이션 로그 소스
    var LOG_SOURCES = [
        { id: "system",          label: "System (journalctl)",       cmd: ["journalctl", "-n", "{lines}", "--no-pager", "-o", "short-iso"] },
        { id: "tailscaled",      label: "Tailscale daemon",          cmd: ["journalctl", "-u", "tailscaled", "-n", "{lines}", "--no-pager", "-o", "short-iso"] },
        { id: "netdata",         label: "Netdata",                   cmd: ["journalctl", "-u", "netdata", "-n", "{lines}", "--no-pager", "-o", "short-iso"] },
        { id: "pm2-monitor",     label: "PM2 (systemd unit)",        cmd: ["journalctl", "-u", "pm2-monitor", "-n", "{lines}", "--no-pager", "-o", "short-iso"] },
        { id: "uptime-kuma-out", label: "Uptime Kuma (out)",         cmd: ["tail", "-n", "{lines}", "/home/monitor/.pm2/logs/uptime-kuma-out.log"] },
        { id: "uptime-kuma-err", label: "Uptime Kuma (error)",       cmd: ["tail", "-n", "{lines}", "/home/monitor/.pm2/logs/uptime-kuma-error.log"] },
        { id: "cockpit",         label: "Cockpit",                   cmd: ["journalctl", "-u", "cockpit", "-n", "{lines}", "--no-pager", "-o", "short-iso"] },
        { id: "ssh-failed",      label: "SSH Failed Attempts",       cmd: ["journalctl", "-u", "ssh", "--grep=Failed", "-n", "{lines}", "--no-pager", "-o", "short-iso"] },
        { id: "fail2ban",        label: "fail2ban",                  cmd: ["journalctl", "-u", "fail2ban", "-n", "{lines}", "--no-pager", "-o", "short-iso"] },
        { id: "docker",          label: "Docker daemon",             cmd: ["journalctl", "-u", "docker", "-n", "{lines}", "--no-pager", "-o", "short-iso"] },
        { id: "ufw",             label: "ufw",                       cmd: ["journalctl", "-k", "--grep=UFW", "-n", "{lines}", "--no-pager", "-o", "short-iso"] },
        { id: "install-monitor", label: "Install/관제 셋업 로그",     cmd: ["tail", "-n", "{lines}", "/var/log/install-monitoring.log"] },
        { id: "admin-bin",       label: "admin-bin 작업 로그 (오늘)", cmd: ["bash", "-c", "ls /var/log/admin-bin/*-$(date +%Y%m%d).log 2>/dev/null | head -1 | xargs -r tail -n {lines}"] }
    ];

    /* ══════════════════════════════════════
       Log Loading
       ══════════════════════════════════════ */

    function loadLog() {
        var sourceId = ($("log-source") || {}).value || "system";
        var lines = ($("log-lines") || {}).value || "100";
        var container = $("log-output");
        if (!container) return;
        container.innerHTML = '<div class="muted loading">Loading...</div>';

        var source = LOG_SOURCES.find(function(s) { return s.id === sourceId; });
        if (!source) {
            container.innerHTML = '<div class="muted">Unknown source</div>';
            return;
        }

        var cmd = source.cmd.map(function(part) {
            return part.replace("{lines}", lines);
        });

        cockpit.spawn(cmd, { superuser: "require" })
            .then(function(output) {
                if (!output.trim()) {
                    container.innerHTML = '<div class="muted">No log entries</div>';
                    return;
                }
                container.innerHTML = '<pre class="log-output">' + SM.escapeHtml(output.trim()) + '</pre>';
                container.scrollTop = container.scrollHeight;
            })
            .fail(function(err) {
                container.innerHTML = '<div class="result-box result-error">' + SM.escapeHtml(SM.errMsg(err)) + '</div>';
            });
    }

    /* ══════════════════════════════════════
       Auto-Refresh
       ══════════════════════════════════════ */

    function toggleAutoRefresh() {
        var cb = $("log-auto-refresh");
        var label = $("log-auto-label");
        if (!cb) return;

        if (cb.checked) {
            autoRefreshTimer = setInterval(loadLog, 10000);
            if (label) label.textContent = "Auto (10s)";
        } else {
            if (autoRefreshTimer) clearInterval(autoRefreshTimer);
            autoRefreshTimer = null;
            if (label) label.textContent = "Auto";
        }
    }

    /* ══════════════════════════════════════
       Initialization
       ══════════════════════════════════════ */

    function initLogs() {
        var sel = $("log-source");
        if (sel) {
            sel.innerHTML = "";
            LOG_SOURCES.forEach(function(s) {
                var opt = document.createElement("option");
                opt.value = s.id;
                opt.textContent = s.label;
                sel.appendChild(opt);
            });
        }

        loadLog();
        SM.bindClick("log-refresh", loadLog);
        SM.bindChange("log-source", loadLog);
        SM.bindChange("log-lines", loadLog);
        SM.bindChange("log-auto-refresh", toggleAutoRefresh);
    }

    SM.registerModule("logs", initLogs);

})();
