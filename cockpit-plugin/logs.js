/* Server Monitor - Log Viewer */
/* Depends on: utils.js (SM namespace) */

(function() {
    "use strict";

    if (!window.SM) { console.error("SM not loaded"); return; }

    var $ = SM.$;
    var autoRefreshTimer = null;

    var LOG_SOURCES = [
        { id: "system",      label: "System (journalctl)",         cmd: ["journalctl", "-n", "{lines}", "--no-pager", "-o", "short-iso"] },
        { id: "httpd-error",  label: "Apache Error Log",           cmd: ["tail", "-n", "{lines}", "/var/log/httpd/error_log"] },
        { id: "httpd-access", label: "Apache Access Log",          cmd: ["tail", "-n", "{lines}", "/var/log/httpd/access_log"] },
        { id: "management",   label: "Management Audit Log",       cmd: ["tail", "-n", "{lines}", "/home/monitor/logs/management.log"] },
        { id: "deploy",       label: "Deploy Log",                 cmd: ["tail", "-n", "{lines}", "/home/monitor/logs/deploy.log"] },
        { id: "ssh-failed",   label: "SSH Failed Attempts",        cmd: ["journalctl", "-u", "sshd", "--grep=Failed", "-n", "{lines}", "--no-pager", "-o", "short-iso"] },
        { id: "monitor-access", label: "Monitor Site Access Log",  cmd: ["tail", "-n", "{lines}", "/home/monitor/logs/monitor-access.log"] },
        { id: "monitor-error",  label: "Monitor Site Error Log",   cmd: ["tail", "-n", "{lines}", "/home/monitor/logs/monitor-error.log"] }
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
