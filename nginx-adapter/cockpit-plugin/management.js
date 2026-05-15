/* Server Monitor - Management: VHost + Account + SSH + PM2 */
/* Depends on: utils.js (SM namespace) */

(function() {
    "use strict";

    var $ = SM.$;
    var Validate = SM.Validate;
    // 보조 서버: PM2 미사용 (Docker 운영). PROTECTED_VHOSTS는 nginx server_name 기반.
    var PM2_PATH = "/usr/bin/false"; // unused — Phase 2 Docker 모듈로 대체
    var PROTECTED_VHOSTS = SM.PROTECTED_VHOSTS || ["monitor-nginx.example.com", "app.example.com"];
    var mgmtInitialized = false;

    /* ══════════════════════════════════════
       VHost Management
       ══════════════════════════════════════ */

    function loadVhostList() {
        var container = $("vhost-list");
        if (!container) return;
        container.innerHTML = '<div class="muted loading">Loading...</div>';
        cockpit.spawn(["ls", "/etc/nginx/sites-available/"], { superuser: "require" })
            .then(function(output) {
                // nginx: 파일명 = domain (default 제외)
                var files = output.trim().split("\n").filter(function(f) {
                    return f && f !== "default";
                });
                if (files.length === 0) {
                    container.innerHTML = '<div class="muted">No VHost files in /etc/nginx/sites-available/</div>';
                    return;
                }
                var results = [];
                var pending = files.length;
                files.forEach(function(file) {
                    cockpit.spawn(["cat", "/etc/nginx/sites-available/" + file], { superuser: "require" })
                        .then(function(content) {
                            var serverName = "", type = "Static", backend = "-";
                            var isProtected = PROTECTED_VHOSTS.indexOf(file) !== -1;
                            content.split("\n").forEach(function(line) {
                                var t = line.trim();
                                if (t.indexOf("server_name") === 0 && !serverName) {
                                    serverName = t.replace("server_name", "").replace(";", "").trim();
                                }
                                if (t.indexOf("proxy_pass") === 0 && backend === "-") {
                                    type = "Reverse Proxy";
                                    backend = t.replace("proxy_pass", "").replace(";", "").trim();
                                }
                                if (t.indexOf("root ") === 0 && backend === "-") {
                                    backend = t.replace("root", "").replace(";", "").trim();
                                }
                            });
                            results.push({ file: file, domain: serverName || file, type: type, backend: backend, isProtected: isProtected });
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
        var html = '<table class="mgmt-table"><thead><tr><th>File</th><th>server_name</th><th>Type</th><th>Backend</th><th>Status</th></tr></thead><tbody>';
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
        // nginx 컨벤션: 파일명 = 도메인
        var filename = domain;
        var confPath = "/etc/nginx/sites-available/" + filename;
        var enabledPath = "/etc/nginx/sites-enabled/" + filename;

        SM.confirmDialog("Create nginx VHost", "Domain: " + domain + "\nBackend: 127.0.0.1:" + port + "\nSSL: " + (ssl ? "Yes (certbot --nginx)" : "No") + "\nFile: " + filename)
            .then(function(ok) {
                if (!ok) return;
                SM.setLoading(btn, true);
                cockpit.spawn(["test", "-f", confPath], { superuser: "require" })
                    .then(function() { SM.setLoading(btn, false); SM.showResult("vhost-result", false, "File already exists: " + filename); })
                    .fail(function() {
                        var conf = "server {\n" +
                            "    listen 80;\n" +
                            "    listen [::]:80;\n" +
                            "    server_name " + domain + ";\n\n" +
                            "    location ^~ /.well-known/acme-challenge/ {\n" +
                            "        root /var/www/html;\n" +
                            "        default_type \"text/plain\";\n" +
                            "    }\n\n" +
                            "    location / {\n" +
                            "        proxy_pass http://127.0.0.1:" + port + ";\n" +
                            "        proxy_http_version 1.1;\n" +
                            "        proxy_set_header Host $host;\n" +
                            "        proxy_set_header X-Real-IP $remote_addr;\n" +
                            "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n" +
                            "        proxy_set_header X-Forwarded-Proto $scheme;\n" +
                            "    }\n" +
                            "}\n";
                        cockpit.spawn(["tee", confPath], { superuser: "require" }).input(conf)
                            .then(function() { return cockpit.spawn(["ln", "-sf", confPath, enabledPath], { superuser: "require" }); })
                            .then(function() { return cockpit.spawn(["nginx", "-t"], { superuser: "require" }); })
                            .then(function() { return cockpit.spawn(["systemctl", "reload", "nginx"], { superuser: "require" }); })
                            .then(function() {
                                SM.logAction("VHOST_CREATE", domain + " -> 127.0.0.1:" + port);
                                if (!ssl) { SM.setLoading(btn, false); SM.showResult("vhost-result", true, "VHost created for " + domain); loadVhostList(); SM.resetForm("vhost"); return; }
                                SM.showResult("vhost-result", true, "VHost created. Issuing SSL via certbot --nginx... (up to 60 sec)");
                                cockpit.spawn(["certbot", "--nginx", "--non-interactive", "--agree-tos", "--email", "admin@example.com", "-d", domain], { superuser: "require" })
                                    .then(function() { SM.setLoading(btn, false); SM.logAction("SSL_ISSUE", domain); SM.showResult("vhost-result", true, "VHost + SSL created for " + domain); loadVhostList(); SM.resetForm("vhost"); })
                                    .fail(function(err) { SM.setLoading(btn, false); SM.logAction("SSL_FAIL", domain + " - " + SM.errMsg(err)); SM.showResult("vhost-result", false, "VHost created but SSL failed: " + SM.errMsg(err)); loadVhostList(); });
                            })
                            .fail(function(err) {
                                cockpit.spawn(["rm", "-f", confPath, enabledPath], { superuser: "require" });
                                SM.setLoading(btn, false); SM.logAction("VHOST_FAIL", domain + " - " + SM.errMsg(err));
                                SM.showResult("vhost-result", false, "Failed (rolled back): " + SM.errMsg(err));
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

    /* ── 보조 서버: PM2 → Docker 컨테이너 운영 ──
       두 데몬 운영:
        - 시스템 docker.service: dev260427/monitor가 docker 그룹 멤버
        - appuser Rootless: sudo -u appuser docker (user namespace, /run/user/1001/docker.sock)
       account select에서 system / appuser 분기.
    */
    function dockerCmdFor(user) {
        if (user === "appuser") {
            return ["sudo", "-u", "appuser", "env", "DOCKER_HOST=unix:///run/user/1001/docker.sock", "XDG_RUNTIME_DIR=/run/user/1001", "docker"];
        }
        return ["docker"]; // 시스템 docker.service
    }

    function loadPm2List() {
        var user = ($("pm2-account-select") || {}).value;
        var container = $("pm2-list");
        if (!container) return;
        if (!user || (user !== "appuser" && user !== "system")) {
            container.innerHTML = '<div class="muted">Select <code>system</code> (host docker) or <code>appuser</code> (Rootless)</div>';
            hidePm2Startup();
            return;
        }
        container.innerHTML = '<div class="muted loading">Loading...</div>';
        var cmd = dockerCmdFor(user).concat(["ps", "-a", "--format", "{{json .}}"]);
        cockpit.spawn(cmd, { superuser: "require" })
            .then(function(output) {
                var lines = output.trim().split("\n").filter(function(l) { return l.trim(); });
                if (lines.length === 0) {
                    container.innerHTML = '<div class="muted">No containers (' + SM.escapeHtml(user) + ' daemon)</div>';
                    hidePm2Startup();
                    return;
                }
                showPm2Startup();
                var html = '<table class="mgmt-table"><thead><tr><th>Name</th><th>Image</th><th>Status</th><th>Ports</th><th>Actions</th></tr></thead><tbody>';
                lines.forEach(function(line) {
                    var c;
                    try { c = JSON.parse(line); } catch(e) { return; }
                    var st = c.State || c.Status || "";
                    var bc = st.indexOf("running") !== -1 ? "badge-ok" : st.indexOf("exited") !== -1 ? "badge-inactive" : "badge-crit";
                    var name = c.Names || c.Name || "-";
                    var image = c.Image || "-";
                    var ports = c.Ports || "-";
                    var status = c.Status || st;
                    var actions = '<button class="btn btn-sm" data-docker-action="restart" data-docker-name="' + SM.escapeHtml(name) + '" data-docker-user="' + SM.escapeHtml(user) + '">Restart</button> ' +
                                  '<button class="btn btn-sm" data-docker-action="logs" data-docker-name="' + SM.escapeHtml(name) + '" data-docker-user="' + SM.escapeHtml(user) + '">Logs</button>';
                    html += "<tr><td>" + SM.escapeHtml(name) + "</td><td><code>" + SM.escapeHtml(image) + "</code></td>" +
                        "<td><span class=\"badge " + bc + "\">" + SM.escapeHtml(status) + "</span></td>" +
                        "<td><code style=\"font-size:0.7rem\">" + SM.escapeHtml(ports) + "</code></td><td>" + actions + "</td></tr>";
                });
                container.innerHTML = html + "</tbody></table>";
                container.querySelectorAll("[data-docker-action]").forEach(function(btn) {
                    btn.addEventListener("click", function() {
                        var action = btn.getAttribute("data-docker-action");
                        var name = btn.getAttribute("data-docker-name");
                        var u = btn.getAttribute("data-docker-user");
                        if (action === "logs") return showDockerLogs(u, name);
                        controlDocker(u, name, action);
                    });
                });
                checkPm2Startup(user);
            })
            .fail(function(err) { container.innerHTML = '<div class="muted">Docker daemon unavailable for ' + SM.escapeHtml(user) + ': ' + SM.escapeHtml(SM.errMsg(err)) + '</div>'; hidePm2Startup(); });
    }

    function controlDocker(user, name, action) {
        SM.confirmDialog("Docker " + action, "Daemon: " + user + "\nContainer: " + name + "\nAction: " + action)
            .then(function(ok) {
                if (!ok) return;
                var cmd = dockerCmdFor(user).concat([action, name]);
                cockpit.spawn(cmd, { superuser: "require" })
                    .then(function() { SM.logAction("DOCKER_" + action.toUpperCase(), user + "/" + name); SM.showResult("pm2-result", true, name + ": " + action + " OK"); loadPm2List(); })
                    .fail(function(err) { SM.showResult("pm2-result", false, name + " " + action + " failed: " + SM.errMsg(err)); });
            });
    }

    function showDockerLogs(user, name) {
        var cmd = dockerCmdFor(user).concat(["logs", "--tail", "100", name]);
        cockpit.spawn(cmd, { superuser: "require" })
            .then(function(out) {
                SM.showResult("pm2-result", true, "Logs: " + name + "\n" + (out.length > 4000 ? "..." + out.slice(-4000) : out));
            })
            .fail(function(err) { SM.showResult("pm2-result", false, "Logs failed: " + SM.errMsg(err)); });
    }

    function hidePm2Startup() { var b=$("pm2-startup-btn"),s=$("pm2-startup-status"); if(b)b.classList.add("hidden"); if(s)s.innerHTML=""; }
    function showPm2Startup() { var b=$("pm2-startup-btn"); if(b){b.classList.add("hidden");} } // nginx 어댑터 환경에선 PM2 startup 등록 미사용

    function checkPm2Startup(user) {
        var statusEl = $("pm2-startup-status");
        if (!statusEl) return;
        // 보조 서버: 시스템 docker는 systemd로 부팅 자동, appuser Rootless는 linger로 자동
        var note = user === "appuser"
            ? '<span class="badge badge-ok">linger=yes (자동 시작)</span>'
            : '<span class="badge badge-ok">docker.service enabled</span>';
        statusEl.innerHTML = note;
    }

    function registerPm2Startup() {
        // 보조 서버: 별도 등록 작업 불필요 (systemd + linger로 자동)
        SM.showResult("pm2-result", true, "nginx 어댑터 환경에서는 별도 startup 등록 불필요: 시스템 docker.service는 enabled, appuser은 linger=yes로 자동 시작됩니다.");
    }

    /* ══════════════════════════════════════
       Initialization
       ══════════════════════════════════════ */

    function populateDockerDaemonSelector() {
        // 보조 서버: pm2-account-select를 시스템 docker / appuser Rootless 분기 select로 사용
        var sel = $("pm2-account-select");
        if (!sel) return;
        sel.innerHTML =
            '<option value="">-- Select Docker daemon --</option>' +
            '<option value="system">system (host docker.service)</option>' +
            '<option value="appuser">appuser (Rootless, /run/user/1001)</option>';
    }

    function initManagement() {
        if (mgmtInitialized) { loadVhostList(); loadAccountList(); return; }
        mgmtInitialized = true;
        SM.ensureLogDir();
        SM.initSubTabs();
        loadVhostList();
        loadAccountList();
        populateDockerDaemonSelector(); // 보조 서버: PM2 → Docker daemon select

        SM.bindSubmit("vhost-form", createVhost);
        SM.bindSubmit("account-form", createAccount);
        SM.bindSubmit("ssh-form", registerSshKey);
        SM.bindClick("vhost-refresh", loadVhostList);
        SM.bindClick("account-refresh", loadAccountList);
        SM.bindClick("ssh-refresh", loadSshKeys);
        SM.bindClick("pm2-refresh", loadPm2List);
        SM.bindChange("ssh-account-select", loadSshKeys);
        SM.bindChange("pm2-account-select", loadPm2List);
        SM.bindClick("pm2-startup-btn", registerPm2Startup);
    }

    var mgmtBtn = document.querySelector('[data-tab="management"]');
    if (mgmtBtn) mgmtBtn.addEventListener("click", function() { setTimeout(initManagement, 50); });

})();
