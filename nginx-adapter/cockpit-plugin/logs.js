/* Server Monitor - Log Viewer */
/* Depends on: utils.js (SM namespace) */

(function() {
    "use strict";

    if (!window.SM) { console.error("SM not loaded"); return; }

    var $ = SM.$;
    var autoRefreshTimer = null;

    // 보조 서버 (Ubuntu/nginx/Docker) 로그 소스
    var LOG_SOURCES = [
        { id: "system",         label: "System (journalctl)",      cmd: ["journalctl", "-n", "{lines}", "--no-pager", "-o", "short-iso"] },
        { id: "nginx-error",    label: "nginx Error Log",          cmd: ["tail", "-n", "{lines}", "/var/log/nginx/error.log"] },
        { id: "nginx-access",   label: "nginx Access Log",         cmd: ["tail", "-n", "{lines}", "/var/log/nginx/access.log"] },
        { id: "monitor-access", label: "monitor-nginx Access Log",     cmd: ["tail", "-n", "{lines}", "/home/monitor/logs/nginx-access.log"] },
        { id: "monitor-error",  label: "monitor-nginx Error Log",      cmd: ["tail", "-n", "{lines}", "/home/monitor/logs/nginx-error.log"] },
        { id: "management",     label: "Management Audit Log",     cmd: ["tail", "-n", "{lines}", "/home/monitor/logs/management.log"] },
        { id: "ssh-failed",     label: "SSH Failed Attempts",      cmd: ["journalctl", "-u", "ssh", "--grep=Failed", "-n", "{lines}", "--no-pager", "-o", "short-iso"] },
        { id: "fail2ban",       label: "fail2ban Log",             cmd: ["journalctl", "-u", "fail2ban", "-n", "{lines}", "--no-pager", "-o", "short-iso"] },
        { id: "docker",         label: "Docker daemon Log",        cmd: ["journalctl", "-u", "docker", "-n", "{lines}", "--no-pager", "-o", "short-iso"] },
        { id: "duckdns",        label: "DuckDNS Update Log",       cmd: ["tail", "-n", "{lines}", "/var/log/duckdns/duck.log"] },
        { id: "ufw",            label: "ufw Log",                  cmd: ["journalctl", "-k", "--grep=UFW", "-n", "{lines}", "--no-pager", "-o", "short-iso"] }
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
