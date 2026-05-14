/* Server Monitor - System Info Panel */
/* Depends on: utils.js (SM namespace) */

(function() {
    "use strict";

    if (!window.SM) { console.error("SM not loaded"); return; }

    var $ = SM.$;

    /* ══════════════════════════════════════
       Cron Jobs
       ══════════════════════════════════════ */

    function loadCronJobs() {
        var container = $("sys-cron-list");
        if (!container) return;
        container.innerHTML = '<div class="muted loading">Loading...</div>';

        var results = [];
        var pending = 2;

        function done() {
            if (--pending > 0) return;
            if (results.length === 0) {
                container.innerHTML = '<div class="muted">No cron jobs found</div>';
                return;
            }
            var html = '<table class="mgmt-table"><thead><tr><th>Source</th><th>Schedule</th><th>Command</th></tr></thead><tbody>';
            results.forEach(function(r) {
                html += '<tr><td><code>' + SM.escapeHtml(r.source) + '</code></td>' +
                    '<td><code>' + SM.escapeHtml(r.schedule) + '</code></td>' +
                    '<td><code>' + SM.escapeHtml(r.cmd) + '</code></td></tr>';
            });
            container.innerHTML = html + '</tbody></table>';
        }

        // User crontabs (보조 서버 사용자)
        cockpit.spawn(["sh", "-c", "for u in root monitor dev260427 appuser; do echo \"==$u==\"; crontab -l -u $u 2>/dev/null || echo '(none)'; done"], { superuser: "require" })
            .then(function(output) {
                var currentUser = "";
                output.split("\n").forEach(function(line) {
                    var m = line.match(/^==(.+)==$/);
                    if (m) { currentUser = m[1]; return; }
                    if (line.trim() && line.indexOf("#") !== 0 && line !== "(none)") {
                        var parts = line.trim().split(/\s+/);
                        if (parts.length >= 6) {
                            results.push({
                                source: currentUser + " crontab",
                                schedule: parts.slice(0, 5).join(" "),
                                cmd: parts.slice(5).join(" ").substring(0, 80)
                            });
                        }
                    }
                });
                done();
            })
            .fail(function() { done(); });

        // /etc/cron.d/
        cockpit.spawn(["sh", "-c", "for f in /etc/cron.d/*; do [ -f \"$f\" ] && echo \"===$f===\" && cat \"$f\"; done"], { superuser: "require" })
            .then(function(output) {
                var currentFile = "";
                output.split("\n").forEach(function(line) {
                    var m = line.match(/^===(.+)===$/);
                    if (m) { currentFile = m[1].replace("/etc/cron.d/", ""); return; }
                    if (line.trim() && line.indexOf("#") !== 0 && line.indexOf("SHELL") !== 0 && line.indexOf("PATH") !== 0 && line.indexOf("MAILTO") !== 0) {
                        var parts = line.trim().split(/\s+/);
                        if (parts.length >= 7) {
                            results.push({
                                source: "cron.d/" + currentFile,
                                schedule: parts.slice(0, 5).join(" "),
                                cmd: parts.slice(6).join(" ").substring(0, 80)
                            });
                        }
                    }
                });
                done();
            })
            .fail(function() { done(); });
    }

    /* ══════════════════════════════════════
       Disk Usage
       ══════════════════════════════════════ */

    function loadDiskUsage() {
        var container = $("sys-disk-list");
        if (!container) return;
        container.innerHTML = '<div class="muted loading">Loading...</div>';

        cockpit.spawn(["du", "-sh",
            "/home/monitor", "/home/dev260427", "/home/appuser",
            "/opt/appuser", "/var/log", "/var/log/appuser", "/var/log/duckdns",
            "/var/lib/docker", "/tmp"], { superuser: "require" })
            .then(function(output) {
                var html = '<table class="mgmt-table"><thead><tr><th>Directory</th><th>Size</th></tr></thead><tbody>';
                output.trim().split("\n").forEach(function(line) {
                    var parts = line.split("\t");
                    if (parts.length >= 2) {
                        html += '<tr><td><code>' + SM.escapeHtml(parts[1]) + '</code></td><td>' + SM.escapeHtml(parts[0]) + '</td></tr>';
                    }
                });
                container.innerHTML = html + '</tbody></table>';
            })
            .fail(function(err) {
                container.innerHTML = '<div class="result-box result-error">' + SM.escapeHtml(SM.errMsg(err)) + '</div>';
            });
    }

    /* ══════════════════════════════════════
       Large Files
       ══════════════════════════════════════ */

    function loadLargeFiles() {
        var container = $("sys-large-files");
        if (!container) return;
        container.innerHTML = '<div class="muted loading">Loading...</div>';

        cockpit.spawn(["sh", "-c",
            "find /home /opt/appuser /var/log -xdev -size +100M -type f -exec ls -lh {} \\; 2>/dev/null"], { superuser: "require" })
            .then(function(output) {
                if (!output.trim()) {
                    container.innerHTML = '<div class="muted">No files larger than 100MB</div>';
                    return;
                }
                var html = '<table class="mgmt-table"><thead><tr><th>Size</th><th>File</th></tr></thead><tbody>';
                output.trim().split("\n").forEach(function(line) {
                    var parts = line.trim().split(/\s+/);
                    if (parts.length >= 9) {
                        var size = parts[4];
                        var path = parts.slice(8).join(" ");
                        html += '<tr><td>' + SM.escapeHtml(size) + '</td><td><code>' + SM.escapeHtml(path) + '</code></td></tr>';
                    }
                });
                container.innerHTML = html + '</tbody></table>';
            })
            .fail(function(err) {
                container.innerHTML = '<div class="result-box result-error">' + SM.escapeHtml(SM.errMsg(err)) + '</div>';
            });
    }

    /* ══════════════════════════════════════
       System Updates
       ══════════════════════════════════════ */

    function loadUpdates() {
        var container = $("sys-updates");
        if (!container) return;
        container.innerHTML = '<div class="muted loading">Checking updates...</div>';

        // Ubuntu: apt list --upgradable. 재부팅 필요 여부도 같이 체크.
        cockpit.spawn(["sh", "-c",
            "apt list --upgradable 2>/dev/null | grep -v '^Listing' | grep -v '^$'; " +
            "echo '---REBOOT---'; " +
            "[ -f /var/run/reboot-required ] && cat /var/run/reboot-required.pkgs 2>/dev/null || echo '재부팅 불필요'"
        ], { superuser: "require" })
            .then(function(output) {
                var parts = output.split("---REBOOT---");
                var pkgs = (parts[0] || "").trim();
                var reboot = (parts[1] || "").trim();
                var lines = pkgs ? pkgs.split("\n").filter(function(l) { return l.trim(); }) : [];
                var summary = '<div class="result-box ' + (lines.length > 0 ? 'result-success' : '') + '">' +
                    lines.length + ' updates available — Reboot: ' + SM.escapeHtml(reboot) + '</div>';
                if (lines.length > 0) {
                    summary += '<pre class="log-output" style="max-height:200px;overflow:auto;margin-top:0.5rem">' +
                        SM.escapeHtml(pkgs) + '</pre>';
                }
                container.innerHTML = summary;
            })
            .fail(function(ex) {
                container.innerHTML = '<div class="result-box result-error">' + SM.escapeHtml(SM.errMsg(ex)) + '</div>';
            });
    }

    /* ══════════════════════════════════════
       Security Audit
       ══════════════════════════════════════ */

    function loadSecurityAudit() {
        var container = $("sys-security");
        if (!container) return;
        container.innerHTML = '<div class="muted loading">Loading...</div>';

        var sections = [];
        var pending = 3;

        function done() {
            if (--pending > 0) return;
            container.innerHTML = sections.join("");
        }

        // SSH failed attempts (last 24h) — Ubuntu unit name: ssh
        cockpit.spawn(["journalctl", "-u", "ssh", "--grep=Failed", "--since=-24h", "--no-pager", "-o", "short-iso"], { superuser: "require" })
            .then(function(output) {
                var lines = output.trim().split("\n").filter(function(l) { return l.trim(); });
                var count = lines.length;
                var badge = count > 20 ? "badge-crit" : count > 5 ? "badge-warn" : "badge-ok";
                sections[0] = '<div class="sys-audit-section"><span class="mgmt-sub-title">SSH Failed (24h)</span> <span class="badge ' + badge + '">' + count + ' attempts</span>';
                if (count > 0) {
                    sections[0] += '<pre class="log-output" style="max-height:150px;overflow:auto;margin-top:0.5rem">' + SM.escapeHtml(lines.slice(-10).join("\n")) + '</pre>';
                }
                sections[0] += '</div>';
                done();
            })
            .fail(function() { sections[0] = '<div class="sys-audit-section"><span class="mgmt-sub-title">SSH Failed</span> <span class="badge badge-inactive">unavailable</span></div>'; done(); });

        // Recent logins
        cockpit.spawn(["last", "-n", "10", "-a"], { superuser: "require" })
            .then(function(output) {
                sections[1] = '<div class="sys-audit-section mt-1"><span class="mgmt-sub-title">Recent Logins</span>' +
                    '<pre class="log-output" style="max-height:150px;overflow:auto;margin-top:0.5rem">' + SM.escapeHtml(output.trim()) + '</pre></div>';
                done();
            })
            .fail(function() { sections[1] = ""; done(); });

        // Firewall denied (last 24h)
        cockpit.spawn(["journalctl", "-k", "--grep=REJECT\\|DROP", "--since=-24h", "--no-pager", "-n", "20", "-o", "short-iso"], { superuser: "require" })
            .then(function(output) {
                var lines = output.trim().split("\n").filter(function(l) { return l.trim(); });
                sections[2] = '<div class="sys-audit-section mt-1"><span class="mgmt-sub-title">Firewall Blocked (24h)</span> <span class="badge badge-inactive">' + lines.length + ' entries</span>';
                if (lines.length > 0) {
                    sections[2] += '<pre class="log-output" style="max-height:150px;overflow:auto;margin-top:0.5rem">' + SM.escapeHtml(lines.slice(-10).join("\n")) + '</pre>';
                }
                sections[2] += '</div>';
                done();
            })
            .fail(function() { sections[2] = ""; done(); });
    }

    /* ══════════════════════════════════════
       Initialization
       ══════════════════════════════════════ */

    function initSystem() {
        loadCronJobs();
        loadDiskUsage();
        loadLargeFiles();
        loadUpdates();
        loadSecurityAudit();
        SM.bindClick("sys-refresh", function() {
            loadCronJobs();
            loadDiskUsage();
            loadLargeFiles();
            loadUpdates();
            loadSecurityAudit();
        });
    }

    SM.registerModule("system", initSystem);

})();
