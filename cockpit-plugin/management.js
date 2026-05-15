/* Server Monitor - Management: VHost + Account + SSH + PM2 */
/* Depends on: utils.js (SM namespace) */

(function() {
    "use strict";

    var $ = SM.$;
    var Validate = SM.Validate;
    var PM2_PATH = "/usr/local/lib/node_modules/pm2/bin/pm2";
    /* Customize: list any vhost .conf filenames the UI must NOT delete/modify. */
    var PROTECTED_VHOSTS = [/* "vhost-app1.conf", "vhost-app2.conf" */];
    var mgmtInitialized = false;

    /* ══════════════════════════════════════
       VHost Management
       ══════════════════════════════════════ */

    function loadVhostList() {
        var container = $("vhost-list");
        if (!container) return;
        container.innerHTML = '<div class="muted loading">Loading...</div>';

        cockpit.spawn(["ls", "/etc/httpd/conf.d/"], { superuser: "require" })
            .then(function(output) {
                var files = output.trim().split("\n").filter(function(f) {
                    return f.indexOf("vhost-") === 0 && f.indexOf(".conf") !== -1 &&
                           f.indexOf("-le-ssl.conf") === -1;
                });
                if (files.length === 0) {
                    container.innerHTML = '<div class="muted">No VHost files found</div>';
                    return;
                }
                var results = [];
                var pending = files.length;
                files.forEach(function(file) {
                    cockpit.spawn(["cat", "/etc/httpd/conf.d/" + file], { superuser: "require" })
                        .then(function(content) {
                            var domain = "", type = "Static", backend = "-";
                            var isProtected = PROTECTED_VHOSTS.indexOf(file) !== -1;
                            content.split("\n").forEach(function(line) {
                                var t = line.trim();
                                if (t.indexOf("ServerName") === 0) domain = t.split(/\s+/)[1] || "";
                                if (t.indexOf("ProxyPass ") === 0 && t.indexOf("ProxyPassReverse") === -1) {
                                    type = "Reverse Proxy"; backend = t.split(/\s+/)[2] || "";
                                }
                                if (t.indexOf("DocumentRoot") === 0) backend = t.split(/\s+/)[1] || "";
                            });
                            results.push({ file: file, domain: domain, type: type, backend: backend, isProtected: isProtected });
                            if (--pending <= 0) renderVhostTable(results, container);
                        })
                        .fail(function() { if (--pending <= 0) renderVhostTable(results, container); });
                });
            })
            .fail(function(err) {
                container.innerHTML = '<div class="result-box result-error">Failed: ' + SM.escapeHtml(SM.errMsg(err)) + "</div>";
            });
    }

    function renderVhostTable(data, container) {
        if (data.length === 0) { container.innerHTML = '<div class="muted">No VHosts found</div>'; return; }
        data.sort(function(a, b) { return a.file.localeCompare(b.file); });
        var html = '<table class="mgmt-table"><thead><tr><th>File</th><th>Domain</th><th>Type</th><th>Backend</th><th>Status</th></tr></thead><tbody>';
        data.forEach(function(v) {
            var badge = v.isProtected ? '<span class="badge badge-warn">protected</span>' : '<span class="badge badge-ok">active</span>';
            html += "<tr><td><code>" + SM.escapeHtml(v.file) + "</code></td><td>" + SM.escapeHtml(v.domain) +
                "</td><td>" + SM.escapeHtml(v.type) + "</td><td><code>" + SM.escapeHtml(v.backend) + "</code></td><td>" + badge + "</td></tr>";
        });
        container.innerHTML = html + "</tbody></table>";
    }

    function createVhost() {
        SM.clearErrors("vhost");
        var domain = ($("vhost-domain") || {}).value || "";
        var port = ($("vhost-port") || {}).value || "";
        var ssl = ($("vhost-ssl") || {}).checked;
        var btn = $("vhost-submit");

        var valid = true;
        if (!Validate.domain(domain.trim())) { SM.showError("vhost-domain-error", "Invalid domain (e.g. api.example.com)"); valid = false; }
        if (!Validate.port(port)) { SM.showError("vhost-port-error", "Port must be 1024 - 65535"); valid = false; }
        if (!valid) return;

        domain = domain.trim();
        var filename = "vhost-" + SM.sanitizeFilename(domain) + ".conf";
        var confPath = "/etc/httpd/conf.d/" + filename;

        SM.confirmDialog("Create VHost", "Domain: " + domain + "\nBackend: localhost:" + port + "\nSSL: " + (ssl ? "Yes" : "No") + "\nFile: " + filename)
            .then(function(ok) {
                if (!ok) return;
                SM.setLoading(btn, true);
                cockpit.spawn(["test", "-f", confPath], { superuser: "require" })
                    .then(function() { SM.setLoading(btn, false); SM.showResult("vhost-result", false, "File already exists: " + filename); })
                    .fail(function() {
                        var conf = "<VirtualHost *:80>\n  ServerName " + domain + "\n  ProxyPreserveHost On\n  ProxyPass / http://localhost:" + port + "/\n  ProxyPassReverse / http://localhost:" + port + "/\n</VirtualHost>\n";
                        cockpit.spawn(["tee", confPath], { superuser: "require" }).input(conf)
                            .then(function() { return cockpit.spawn(["apachectl", "configtest"], { superuser: "require" }); })
                            .then(function() { return cockpit.spawn(["systemctl", "reload", "httpd"], { superuser: "require" }); })
                            .then(function() {
                                SM.logAction("VHOST_CREATE", domain + " -> localhost:" + port);
                                if (!ssl) { SM.setLoading(btn, false); SM.showResult("vhost-result", true, "VHost created for " + domain); loadVhostList(); SM.resetForm("vhost"); return; }
                                SM.showResult("vhost-result", true, "VHost created. Issuing SSL... (up to 60 sec)");
                                var emailDomain = domain.split(".").slice(-2).join(".");
                                cockpit.spawn(["certbot", "--apache", "--non-interactive", "--agree-tos", "--email", "admin@" + emailDomain, "-d", domain], { superuser: "require" })
                                    .then(function() { SM.setLoading(btn, false); SM.logAction("SSL_ISSUE", domain); SM.showResult("vhost-result", true, "VHost + SSL created for " + domain); loadVhostList(); SM.resetForm("vhost"); })
                                    .fail(function(err) { SM.setLoading(btn, false); SM.logAction("SSL_FAIL", domain + " - " + SM.errMsg(err)); SM.showResult("vhost-result", false, "VHost created but SSL failed: " + SM.errMsg(err)); loadVhostList(); });
                            })
                            .fail(function(err) {
                                cockpit.spawn(["rm", "-f", confPath], { superuser: "require" });
                                SM.setLoading(btn, false); SM.logAction("VHOST_FAIL", domain + " - " + SM.errMsg(err));
                                SM.showResult("vhost-result", false, "Failed (conf removed): " + SM.errMsg(err));
                            });
                    });
            });
    }

    /* ══════════════════════════════════════
       Account Management
       ══════════════════════════════════════ */

    function loadAccountList() {
        var container = $("account-list");
        if (!container) return;
        container.innerHTML = '<div class="muted loading">Loading...</div>';
        cockpit.spawn(["awk", "-F:", "$3 >= 1000 && $3 < 65534 { print $1 \":\" $3 \":\" $6 }", "/etc/passwd"])
            .then(function(output) {
                SM.accounts = [];
                output.trim().split("\n").forEach(function(line) {
                    if (!line) return;
                    var p = line.split(":");
                    if (p.length >= 3) SM.accounts.push({ name: p[0], uid: p[1], home: p[2] });
                });
                renderAccountTable(container);
                SM.populateAccountSelectors(["ssh-account-select", "pm2-account-select"]);
            })
            .fail(function(err) { container.innerHTML = '<div class="result-box result-error">Failed: ' + SM.escapeHtml(SM.errMsg(err)) + "</div>"; });
    }

    function renderAccountTable(container) {
        if (SM.accounts.length === 0) { container.innerHTML = '<div class="muted">No user accounts found</div>'; return; }
        var html = '<div class="mgmt-header" style="margin-bottom:0.5rem">' +
            '<button class="btn btn-sm" id="account-disk-calc-all">Calculate All Disk Usage</button>' +
            '</div>' +
            '<table class="mgmt-table"><thead><tr><th>Username</th><th>UID</th><th>Home</th><th>Disk Usage</th></tr></thead><tbody>';
        SM.accounts.forEach(function(a) {
            var nameEsc = SM.escapeHtml(a.name);
            var homeEsc = SM.escapeHtml(a.home);
            html += "<tr>" +
                "<td>" + nameEsc + "</td>" +
                "<td>" + SM.escapeHtml(a.uid) + "</td>" +
                "<td><code>" + homeEsc + "</code></td>" +
                "<td>" +
                  '<span class="acc-disk muted" data-disk-user="' + nameEsc + '">—</span> ' +
                  '<button class="btn btn-sm" data-disk-calc="' + nameEsc + '" data-disk-home="' + homeEsc + '">Calc</button>' +
                "</td>" +
                "</tr>";
        });
        container.innerHTML = html + "</tbody></table>" +
            '<div class="card mt-1">' +
              '<div class="mgmt-header">' +
                '<span class="mgmt-sub-title">Server Disk Usage (전체 파일시스템)</span>' +
                '<button class="btn btn-sm" id="server-disk-refresh">Refresh</button>' +
              '</div>' +
              '<div id="server-disk-rows"><div class="muted loading">Loading...</div></div>' +
            '</div>';

        container.querySelectorAll("[data-disk-calc]").forEach(function(btn) {
            btn.addEventListener("click", function() {
                calcAccountDisk(btn.getAttribute("data-disk-calc"), btn.getAttribute("data-disk-home"), btn);
            });
        });
        var allBtn = $("account-disk-calc-all");
        if (allBtn) allBtn.addEventListener("click", function() {
            allBtn.disabled = true;
            allBtn.textContent = "Calculating...";
            var pending = SM.accounts.length;
            SM.accounts.forEach(function(a) {
                calcAccountDisk(a.name, a.home, null, function() {
                    if (--pending <= 0) { allBtn.disabled = false; allBtn.textContent = "Calculate All Disk Usage"; }
                });
            });
        });
        SM.bindClick("server-disk-refresh", loadServerDisk);
        loadServerDisk();
    }

    function loadServerDisk() {
        var rows = $("server-disk-rows");
        if (!rows) return;
        rows.innerHTML = '<div class="muted loading">Loading...</div>';
        // 가상/임시 파일시스템 제외 — 실제 디스크 사용량만
        cockpit.spawn(["df", "-h", "--output=source,size,used,avail,pcent,target",
                       "-x", "tmpfs", "-x", "devtmpfs", "-x", "squashfs", "-x", "overlay", "-x", "fuse"])
            .then(function(output) {
                var lines = output.trim().split("\n");
                if (lines.length < 2) { rows.innerHTML = '<div class="muted">No filesystems</div>'; return; }
                var html = '<table class="mgmt-table"><thead><tr>' +
                    '<th>Mountpoint</th><th>Device</th><th>Size</th><th>Used</th><th>Avail</th><th>Use%</th></tr></thead><tbody>';
                for (var i = 1; i < lines.length; i++) {
                    var p = lines[i].trim().split(/\s+/);
                    if (p.length < 6) continue;
                    var src = p[0], size = p[1], used = p[2], avail = p[3], pct = p[4], target = p[5];
                    var pctNum = parseInt(pct.replace('%',''), 10) || 0;
                    var color = pctNum > 90 ? "red" : pctNum > 70 ? "orange" : "green";
                    html += '<tr>' +
                        '<td><code>' + SM.escapeHtml(target) + '</code></td>' +
                        '<td><code style="font-size:0.7rem">' + SM.escapeHtml(src) + '</code></td>' +
                        '<td>' + SM.escapeHtml(size) + '</td>' +
                        '<td>' + SM.escapeHtml(used) + '</td>' +
                        '<td><strong>' + SM.escapeHtml(avail) + '</strong></td>' +
                        '<td>' +
                          '<div class="progress" style="display:inline-block;width:80px;vertical-align:middle;margin-right:0.4rem">' +
                            '<div class="progress-fill ' + color + '" style="width:' + pctNum + '%"></div>' +
                          '</div>' +
                          SM.escapeHtml(pct) +
                        '</td>' +
                        '</tr>';
                }
                rows.innerHTML = html + '</tbody></table>';
            })
            .fail(function(err) {
                rows.innerHTML = '<div class="result-box result-error">Failed: ' + SM.escapeHtml(SM.errMsg(err)) + '</div>';
            });
    }

    function calcAccountDisk(name, home, btn, done) {
        var span = document.querySelector('.acc-disk[data-disk-user="' + name + '"]');
        if (span) { span.textContent = "..."; span.className = "acc-disk muted loading"; }
        if (btn) { btn.disabled = true; btn.textContent = "..."; }
        // -shx: 같은 파일시스템 내에서 합산. 다른 마운트(예: bind mount, FUSE)는 제외.
        cockpit.spawn(["du", "-shx", home], { superuser: "require", err: "ignore" })
            .then(function(output) {
                var size = (output.split(/\s+/)[0] || "?");
                if (span) {
                    span.textContent = size;
                    span.className = "acc-disk badge badge-ok";
                    span.title = home + " (du -shx)";
                }
            })
            .fail(function(err) {
                if (span) { span.textContent = "fail"; span.className = "acc-disk badge badge-crit"; span.title = SM.errMsg(err); }
            })
            .always(function() {
                if (btn) { btn.disabled = false; btn.textContent = "Calc"; }
                if (done) done();
            });
    }

    function createAccount() {
        SM.clearErrors("account");
        var username = ($("account-username") || {}).value || "";
        var password = ($("account-password") || {}).value || "";
        var confirm  = ($("account-confirm") || {}).value || "";
        var btn = $("account-submit");
        var valid = true;
        if (!Validate.username(username.trim())) { SM.showError("account-username-error", "Lowercase, digits, hyphens, underscores. 3-31 chars."); valid = false; }
        if (!Validate.password(password)) { SM.showError("account-password-error", "Minimum 8 characters"); valid = false; }
        if (password !== confirm) { SM.showError("account-confirm-error", "Passwords do not match"); valid = false; }
        if (!valid) return;
        username = username.trim();
        SM.confirmDialog("Create Account", "Username: " + username + "\nHome: /home/" + username + "\nNote: No sudo privileges will be granted.")
            .then(function(ok) {
                if (!ok) return;
                SM.setLoading(btn, true);
                cockpit.spawn(["id", username])
                    .then(function() { SM.setLoading(btn, false); SM.showResult("account-result", false, "Account already exists: " + username); })
                    .fail(function() {
                        cockpit.spawn(["useradd", "-m", username], { superuser: "require" })
                            .then(function() { return cockpit.spawn(["chpasswd"], { superuser: "require" }).input(username + ":" + password); })
                            .then(function() { return cockpit.spawn(["chmod", "711", "/home/" + username], { superuser: "require" }); })
                            .then(function() { SM.setLoading(btn, false); SM.logAction("ACCOUNT_CREATE", username); SM.showResult("account-result", true, "Account created: " + username); SM.resetForm("account"); loadAccountList(); })
                            .fail(function(err) { SM.setLoading(btn, false); SM.showResult("account-result", false, "Failed: " + SM.errMsg(err)); });
                    });
            });
    }

    /* ══════════════════════════════════════
       SSH Key Management
       ══════════════════════════════════════ */

    function loadSshKeys() {
        var user = ($("ssh-account-select") || {}).value;
        var container = $("ssh-key-list");
        if (!container) return;
        if (!SM.validSelectedUser(user, null)) { container.innerHTML = '<div class="muted">Select an account to view SSH keys</div>'; return; }
        container.innerHTML = '<div class="muted loading">Loading...</div>';
        cockpit.spawn(["cat", "/home/" + user + "/.ssh/authorized_keys"], { superuser: "require" })
            .then(function(output) {
                var keys = output.trim().split("\n").filter(function(l) { return l.trim(); });
                if (keys.length === 0) { container.innerHTML = '<div class="muted">No SSH keys registered</div>'; return; }
                var html = '<table class="mgmt-table"><thead><tr><th>Type</th><th>Key</th><th>Comment</th></tr></thead><tbody>';
                keys.forEach(function(key) {
                    var p = key.trim().split(/\s+/);
                    var kd = p[1] || "";
                    var preview = kd.length > 30 ? kd.substring(0, 16) + "..." + kd.slice(-8) : kd;
                    html += "<tr><td><code>" + SM.escapeHtml(p[0] || "") + "</code></td><td><code>" + SM.escapeHtml(preview) + "</code></td><td>" + SM.escapeHtml(p.slice(2).join(" ") || "-") + "</td></tr>";
                });
                container.innerHTML = html + "</tbody></table>";
            })
            .fail(function() { container.innerHTML = '<div class="muted">No SSH keys (no .ssh directory)</div>'; });
    }

    function registerSshKey() {
        SM.clearErrors("ssh");
        var user = ($("ssh-account-select") || {}).value;
        var key = ($("ssh-key-input") || {}).value || "";
        var btn = $("ssh-submit");
        key = key.trim();
        var valid = true;
        if (!SM.validSelectedUser(user, "ssh-account-error")) valid = false;
        if (!Validate.sshKey(key)) { SM.showError("ssh-key-error", "Invalid key (ssh-rsa, ssh-ed25519, or ecdsa)"); valid = false; }
        if (!valid) return;
        var comment = key.split(/\s+/).slice(2).join(" ") || "(no comment)";
        SM.confirmDialog("Register SSH Key", "Account: " + user + "\nKey: " + comment)
            .then(function(ok) {
                if (!ok) return;
                SM.setLoading(btn, true);
                cockpit.spawn(["mkdir", "-p", "/home/" + user + "/.ssh"], { superuser: "require" })
                    .then(function() { return cockpit.spawn(["chmod", "700", "/home/" + user + "/.ssh"], { superuser: "require" }); })
                    .then(function() { return cockpit.spawn(["tee", "-a", "/home/" + user + "/.ssh/authorized_keys"], { superuser: "require" }).input(key + "\n"); })
                    .then(function() { return cockpit.spawn(["chmod", "600", "/home/" + user + "/.ssh/authorized_keys"], { superuser: "require" }); })
                    .then(function() { return cockpit.spawn(["chown", "-R", user + ":" + user, "/home/" + user + "/.ssh"], { superuser: "require" }); })
                    .then(function() { SM.setLoading(btn, false); SM.logAction("SSH_KEY_ADD", user + " - " + comment); SM.showResult("ssh-result", true, "SSH key registered for " + user); $("ssh-key-input").value = ""; loadSshKeys(); })
                    .fail(function(err) { SM.setLoading(btn, false); SM.showResult("ssh-result", false, "Failed: " + SM.errMsg(err)); });
            });
    }

    /* ══════════════════════════════════════
       PM2 Management
       ══════════════════════════════════════ */

    function loadPm2List() {
        var user = ($("pm2-account-select") || {}).value;
        var container = $("pm2-list");
        if (!container) return;
        if (!SM.validSelectedUser(user, null)) { container.innerHTML = '<div class="muted">Select an account to view PM2 processes</div>'; hidePm2Startup(); return; }
        container.innerHTML = '<div class="muted loading">Loading...</div>';
        cockpit.spawn(["sudo", "-u", user, "env", "HOME=/home/" + user, PM2_PATH, "jlist"], { superuser: "require" })
            .then(function(output) {
                var procs;
                try { procs = JSON.parse(output); } catch(e) { procs = []; }
                if (!procs || procs.length === 0) { container.innerHTML = '<div class="muted">No PM2 processes for ' + SM.escapeHtml(user) + "</div>"; hidePm2Startup(); return; }
                showPm2Startup();
                var html = '<table class="mgmt-table"><thead><tr><th>Name</th><th>ID</th><th>Mode</th><th>Status</th><th>CPU</th><th>Mem</th><th>Uptime</th><th>Restarts</th><th>Actions</th></tr></thead><tbody>';
                procs.forEach(function(p) {
                    var st = (p.pm2_env && p.pm2_env.status) || "unknown";
                    var bc = st === "online" ? "badge-ok" : st === "stopped" ? "badge-inactive" : "badge-crit";
                    var mem = p.monit ? fmtMem(p.monit.memory) : "-";
                    var cpu = p.monit ? p.monit.cpu + "%" : "-";
                    var up = (p.pm2_env && p.pm2_env.pm_uptime) ? fmtUp(Date.now() - p.pm2_env.pm_uptime) : "-";
                    var nameEsc = SM.escapeHtml(p.name);
                    var userEsc = SM.escapeHtml(user);
                    var actions;
                    if (st === "online") {
                        actions = '<button class="btn btn-sm" data-pm2-action="restart" data-pm2-user="' + userEsc + '" data-pm2-name="' + nameEsc + '">Restart</button>' +
                                  ' <button class="btn btn-sm btn-danger" data-pm2-action="stop" data-pm2-user="' + userEsc + '" data-pm2-name="' + nameEsc + '">Stop</button>' +
                                  ' <button class="btn btn-sm" data-pm2-action="logs" data-pm2-user="' + userEsc + '" data-pm2-name="' + nameEsc + '">Logs</button>';
                    } else {
                        actions = '<button class="btn btn-sm btn-primary" data-pm2-action="start" data-pm2-user="' + userEsc + '" data-pm2-name="' + nameEsc + '">Start</button>' +
                                  ' <button class="btn btn-sm" data-pm2-action="restart" data-pm2-user="' + userEsc + '" data-pm2-name="' + nameEsc + '">Restart</button>' +
                                  ' <button class="btn btn-sm" data-pm2-action="logs" data-pm2-user="' + userEsc + '" data-pm2-name="' + nameEsc + '">Logs</button>';
                    }
                    html += "<tr><td>" + nameEsc + "</td><td>" + SM.escapeHtml(String(p.pm_id !== undefined ? p.pm_id : "-")) + "</td><td>" + SM.escapeHtml((p.pm2_env && p.pm2_env.exec_mode) || "-") + "</td><td><span class=\"badge " + bc + "\">" + SM.escapeHtml(st) + "</span></td><td>" + SM.escapeHtml(cpu) + "</td><td>" + SM.escapeHtml(mem) + "</td><td>" + SM.escapeHtml(up) + "</td><td>" + SM.escapeHtml(String((p.pm2_env && p.pm2_env.restart_time) || 0)) + "</td><td>" + actions + "</td></tr>";
                });
                container.innerHTML = html + "</tbody></table>";

                container.querySelectorAll("[data-pm2-action]").forEach(function(btn) {
                    btn.addEventListener("click", function() {
                        var action = btn.getAttribute("data-pm2-action");
                        var name = btn.getAttribute("data-pm2-name");
                        var u = btn.getAttribute("data-pm2-user");
                        if (action === "logs") return showPm2Logs(u, name);
                        controlPm2(u, name, action);
                    });
                });
                checkPm2Startup(user);
            })
            .fail(function() { container.innerHTML = '<div class="muted">No PM2 daemon for ' + SM.escapeHtml(user) + "</div>"; hidePm2Startup(); });
    }

    function controlPm2(user, name, action) {
        var label = action.charAt(0).toUpperCase() + action.slice(1);
        var note = action === "stop" ? "\n\n프로세스가 stopped 상태가 됩니다. 자동 save로 dump.pm2에도 stopped 상태가 보존되어 다음 재부팅에서도 시작되지 않습니다." :
                   action === "restart" ? "\n\n잠시 다운타임이 발생합니다. 작업 후 자동 save로 dump 갱신." :
                   "\n\n자동 save로 dump 갱신.";
        SM.confirmDialog("PM2 " + label,
            "Account: " + user + "\nProcess: " + name + "\nAction: " + label + note)
            .then(function(ok) {
                if (!ok) return;
                cockpit.spawn(["sudo", "-u", user, "env", "HOME=/home/" + user, PM2_PATH, action, name], { superuser: "require" })
                    .then(function() {
                        return cockpit.spawn(["sudo", "-u", user, "env", "HOME=/home/" + user, PM2_PATH, "save"], { superuser: "require" });
                    })
                    .then(function() {
                        SM.logAction("PM2_" + action.toUpperCase(), user + "/" + name);
                        SM.showResult("pm2-result", true, name + " " + action + " OK (dump 갱신)");
                        loadPm2List();
                    })
                    .fail(function(err) {
                        SM.showResult("pm2-result", false, name + " " + action + " failed: " + SM.errMsg(err));
                    });
            });
    }

    function showPm2Logs(user, name) {
        var panel = $("pm2-logs-panel");
        var content = $("pm2-logs-content");
        var title = $("pm2-logs-title");
        if (panel) {
            panel.style.display = "block";
            if (title) title.textContent = "Logs — " + user + " / " + name;
            if (content) content.innerHTML = '<div class="muted loading">Loading last 200 lines...</div>';
        }
        cockpit.spawn(["sudo", "-u", user, "env", "HOME=/home/" + user, PM2_PATH, "logs", name, "--lines", "200", "--nostream"], { superuser: "require" })
            .then(function(out) {
                SM.logAction("PM2_LOGS_VIEW", user + "/" + name);
                if (content) {
                    var trimmed = out && out.length > 12000 ? "...(truncated to last 12 KB)...\n" + out.slice(-12000) : out;
                    content.innerHTML = '<pre class="log-scroll-container" style="white-space:pre-wrap;font-size:0.7rem;max-height:400px;overflow:auto">' + SM.escapeHtml(trimmed || "(empty)") + '</pre>';
                }
            })
            .fail(function(err) {
                if (content) content.innerHTML = '<div class="result-box result-error">' + SM.escapeHtml(SM.errMsg(err)) + '</div>';
            });
    }

    function fmtMem(b) { if (!b) return "-"; if (b >= 1073741824) return (b/1073741824).toFixed(1)+" GB"; if (b >= 1048576) return (b/1048576).toFixed(1)+" MB"; return Math.round(b/1024)+" KB"; }
    function fmtUp(ms) { var s=Math.floor(ms/1000),d=Math.floor(s/86400),h=Math.floor((s%86400)/3600),m=Math.floor((s%3600)/60); if(d>0)return d+"d "+h+"h"; if(h>0)return h+"h "+m+"m"; return m+"m"; }

    function hidePm2Startup() { var b=$("pm2-startup-btn"),s=$("pm2-startup-status"); if(b)b.classList.add("hidden"); if(s)s.innerHTML=""; }
    function showPm2Startup() { var b=$("pm2-startup-btn"); if(b){b.classList.remove("hidden");b.disabled=false;b.textContent="Register Startup";} }

    function checkPm2Startup(user) {
        var statusEl = $("pm2-startup-status");
        if (!statusEl) return;
        cockpit.spawn(["systemctl", "is-enabled", "pm2-" + user], { superuser: "require" })
            .then(function(out) {
                if (out.trim() === "enabled") { statusEl.innerHTML = '<span class="badge badge-ok">startup registered</span>'; var b=$("pm2-startup-btn"); if(b){b.textContent="Already Registered";b.disabled=true;} }
                else { statusEl.innerHTML = '<span class="badge badge-warn">not registered</span>'; }
            })
            .fail(function() { statusEl.innerHTML = '<span class="badge badge-inactive">not registered</span>'; var b=$("pm2-startup-btn"); if(b){b.disabled=false;b.textContent="Register Startup";} });
    }

    function registerPm2Startup() {
        var user = ($("pm2-account-select") || {}).value;
        var btn = $("pm2-startup-btn");
        if (!btn || !SM.validSelectedUser(user, null)) return;
        SM.confirmDialog("Register PM2 Startup", "Account: " + user + "\nService: pm2-" + user + ".service\nPM2 processes will auto-start on reboot.")
            .then(function(ok) {
                if (!ok) return;
                SM.setLoading(btn, true);
                cockpit.spawn(["env", "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin", PM2_PATH, "startup", "systemd", "-u", user, "--hp", "/home/" + user], { superuser: "require" })
                    .then(function() { return cockpit.spawn(["sudo", "-u", user, "env", "HOME=/home/" + user, PM2_PATH, "save"], { superuser: "require" }); })
                    .then(function() { SM.setLoading(btn, false); SM.logAction("PM2_STARTUP", user); SM.showResult("pm2-result", true, "PM2 startup registered for " + user); checkPm2Startup(user); })
                    .fail(function(err) { SM.setLoading(btn, false); SM.showResult("pm2-result", false, "Failed: " + SM.errMsg(err)); });
            });
    }

    /* ══════════════════════════════════════
       Initialization
       ══════════════════════════════════════ */

    function initManagement() {
        if (mgmtInitialized) { loadVhostList(); loadAccountList(); return; }
        mgmtInitialized = true;
        SM.ensureLogDir();
        SM.initSubTabs();
        loadVhostList();
        loadAccountList();

        SM.bindSubmit("vhost-form", createVhost);
        SM.bindSubmit("account-form", createAccount);
        SM.bindSubmit("ssh-form", registerSshKey);
        SM.bindClick("vhost-refresh", loadVhostList);
        SM.bindClick("account-refresh", loadAccountList);
        SM.bindClick("ssh-refresh", loadSshKeys);
        SM.bindClick("pm2-refresh", loadPm2List);
        SM.bindClick("pm2-logs-close", function() { var p = $("pm2-logs-panel"); if (p) p.style.display = "none"; });
        SM.bindChange("ssh-account-select", loadSshKeys);
        SM.bindChange("pm2-account-select", loadPm2List);
        SM.bindClick("pm2-startup-btn", registerPm2Startup);
    }

    var mgmtBtn = document.querySelector('[data-tab="management"]');
    if (mgmtBtn) mgmtBtn.addEventListener("click", function() { setTimeout(initManagement, 50); });

})();
