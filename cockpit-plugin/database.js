/* Server Monitor - Database Management (MariaDB) */
/* Depends on: utils.js (SM namespace) */

(function() {
    "use strict";

    if (!window.SM) { console.error("SM not loaded"); return; }

    var $ = SM.$;
    var Validate = SM.Validate;
    var DB_CMD = "/usr/local/bin/server-monitor-db";
    var SYSTEM_DBS = ["information_schema", "mysql", "performance_schema", "sys"];
    var databases = [];

    /* ══════════════════════════════════════
       Database List
       ══════════════════════════════════════ */

    function loadDatabases() {
        var container = $("db-list");
        if (!container) return;
        container.innerHTML = '<div class="muted loading">Loading...</div>';

        cockpit.spawn([DB_CMD, "list-databases"], { superuser: "require" })
            .then(function(output) {
                databases = output.trim().split("\n").filter(function(d) { return d.trim(); });
                renderDatabaseTable(container);
                populateDbSelector();
            })
            .fail(function(err) {
                container.innerHTML = '<div class="result-box result-error">' + SM.escapeHtml(SM.errMsg(err)) + '</div>';
            });
    }

    function renderDatabaseTable(container) {
        if (databases.length === 0) {
            container.innerHTML = '<div class="muted">No databases found</div>';
            return;
        }
        var html = '<table class="mgmt-table"><thead><tr><th>Database</th><th>Type</th></tr></thead><tbody>';
        databases.forEach(function(db) {
            var isSystem = SYSTEM_DBS.indexOf(db) !== -1;
            var badge = isSystem
                ? '<span class="badge badge-inactive">system</span>'
                : '<span class="badge badge-ok">user</span>';
            html += '<tr><td><code>' + SM.escapeHtml(db) + '</code></td><td>' + badge + '</td></tr>';
        });
        container.innerHTML = html + '</tbody></table>';
    }

    function populateDbSelector() {
        ["db-user-target", "db-grant-target"].forEach(function(selId) {
            var sel = $(selId);
            if (!sel) return;
            var prev = sel.value;
            sel.innerHTML = '<option value="">-- Select Database --</option>';
            databases.forEach(function(db) {
                if (SYSTEM_DBS.indexOf(db) !== -1) return;
                var opt = document.createElement("option");
                opt.value = db;
                opt.textContent = db;
                sel.appendChild(opt);
            });
            if (prev) sel.value = prev;
        });
    }

    function populateUserSelector(users) {
        var sel = $("db-grant-user");
        if (!sel) return;
        var prev = sel.value;
        sel.innerHTML = '<option value="">-- Select User --</option>';
        users.forEach(function(u) {
            if (SM.SYSTEM_DB_USERS.indexOf(u.name) !== -1) return;
            var val = u.name + "@" + u.host;
            var opt = document.createElement("option");
            opt.value = val;
            opt.textContent = val;
            sel.appendChild(opt);
        });
        if (prev) sel.value = prev;
    }

    function parseGrantDb(line) {
        var onIdx = line.indexOf(" ON ");
        var toIdx = line.indexOf(".* TO ");
        if (onIdx < 0 || toIdx < 0 || toIdx <= onIdx) return null;
        var raw = line.substring(onIdx + 4, toIdx).trim();
        if (raw === "*") return null;
        raw = raw.replace(/^`/, "").replace(/`$/, "").replace(/\\_/g, "_");
        if (!/^[a-zA-Z0-9_]{1,64}$/.test(raw)) return null;
        return raw;
    }

    function createDatabase() {
        SM.clearErrors("db-create");
        var name = ($("db-create-name") || {}).value || "";
        var btn = $("db-create-submit");
        name = name.trim();

        if (!Validate.dbName(name)) {
            SM.showError("db-create-name-error", "Letters, digits, underscore only. 1-64 chars.");
            return;
        }

        SM.confirmDialog("Create Database", "Name: " + name + "\nCharset: utf8mb4\nCollation: utf8mb4_unicode_ci")
            .then(function(ok) {
                if (!ok) return;
                SM.setLoading(btn, true);
                cockpit.spawn([DB_CMD, "create-database", name], { superuser: "require" })
                    .then(function() {
                        SM.setLoading(btn, false);
                        SM.logAction("DB_CREATE", name);
                        SM.showResult("db-create-result", true, "Database created: " + name);
                        SM.resetForm("db-create");
                        loadDatabases();
                    })
                    .fail(function(err) {
                        SM.setLoading(btn, false);
                        SM.showResult("db-create-result", false, "Failed: " + SM.errMsg(err));
                    });
            });
    }

    /* ══════════════════════════════════════
       User Management
       ══════════════════════════════════════ */

    function loadUsers() {
        var container = $("db-user-list");
        if (!container) return;
        container.innerHTML = '<div class="muted loading">Loading...</div>';

        cockpit.spawn([DB_CMD, "list-users"], { superuser: "require" })
            .then(function(output) {
                var users = [];
                output.trim().split("\n").forEach(function(line) {
                    if (!line.trim()) return;
                    var parts = line.split("\t");
                    if (parts.length >= 2) {
                        users.push({ name: parts[0], host: parts[1] });
                    }
                });
                renderUserTable(users, container);
                populateUserSelector(users);
            })
            .fail(function(err) {
                container.innerHTML = '<div class="result-box result-error">' + SM.escapeHtml(SM.errMsg(err)) + '</div>';
            });
    }

    function renderUserTable(users, container) {
        if (users.length === 0) {
            container.innerHTML = '<div class="muted">No users found</div>';
            return;
        }
        var html = '<table class="mgmt-table"><thead><tr><th>User</th><th>Host</th><th>Type</th><th>Actions</th></tr></thead><tbody>';
        users.forEach(function(u) {
            var isSystem = SM.SYSTEM_DB_USERS.indexOf(u.name) !== -1;
            var badge = isSystem
                ? '<span class="badge badge-inactive">system</span>'
                : '<span class="badge badge-ok">user</span>';
            var actions = '<button class="btn btn-sm" data-grants-user="' + SM.escapeHtml(u.name) +
                '" data-grants-host="' + SM.escapeHtml(u.host) + '">Grants</button>';
            if (!isSystem) {
                actions += ' <button class="btn btn-sm btn-danger" data-drop-user="' + SM.escapeHtml(u.name) +
                    '" data-drop-host="' + SM.escapeHtml(u.host) + '">Drop</button>';
            }
            html += '<tr><td><code>' + SM.escapeHtml(u.name) + '</code></td><td>' +
                SM.escapeHtml(u.host) + '</td><td>' + badge + '</td><td>' + actions + '</td></tr>';
        });
        container.innerHTML = html + '</tbody></table>';

        container.querySelectorAll("[data-grants-user]").forEach(function(btn) {
            btn.addEventListener("click", function() {
                showGrants(btn.getAttribute("data-grants-user"), btn.getAttribute("data-grants-host"));
            });
        });
        container.querySelectorAll("[data-drop-user]").forEach(function(btn) {
            btn.addEventListener("click", function() {
                dropUser(btn.getAttribute("data-drop-user"), btn.getAttribute("data-drop-host"));
            });
        });
    }

    function showGrants(user, host) {
        var panel = $("db-grants-panel");
        var content = $("db-grants-content");
        var title = $("db-grants-title");
        if (!panel || !content) return;

        panel.style.display = "block";
        title.textContent = "Grants for " + user + "@" + host;
        content.innerHTML = '<div class="muted loading">Loading...</div>';

        cockpit.spawn([DB_CMD, "show-grants", user, host], { superuser: "require" })
            .then(function(output) {
                var lines = output.trim().split("\n").filter(function(l) { return l.trim(); });
                if (lines.length === 0) {
                    content.innerHTML = '<div class="muted">No grants found</div>';
                    return;
                }
                var isSystem = SM.SYSTEM_DB_USERS.indexOf(user) !== -1;
                var html = '<div class="grant-list">';
                lines.forEach(function(line) {
                    var dbName = parseGrantDb(line);
                    var revokeBtn = "";
                    if (dbName && !isSystem) {
                        revokeBtn = ' <button class="btn btn-sm btn-danger" data-revoke-db="' +
                            SM.escapeHtml(dbName) + '" data-revoke-user="' + SM.escapeHtml(user) +
                            '" data-revoke-host="' + SM.escapeHtml(host) + '">Revoke</button>';
                    }
                    html += '<div class="grant-row"><code>' + SM.escapeHtml(line) + '</code>' + revokeBtn + '</div>';
                });
                content.innerHTML = html + '</div>';

                content.querySelectorAll("[data-revoke-db]").forEach(function(btn) {
                    btn.addEventListener("click", function() {
                        revokeDatabase(
                            btn.getAttribute("data-revoke-user"),
                            btn.getAttribute("data-revoke-host"),
                            btn.getAttribute("data-revoke-db")
                        );
                    });
                });
            })
            .fail(function(err) {
                content.innerHTML = '<div class="result-box result-error">' + SM.escapeHtml(SM.errMsg(err)) + '</div>';
            });
    }

    function grantDatabase() {
        SM.clearErrors("db-grant");
        var userHost = ($("db-grant-user") || {}).value || "";
        var targetDb = ($("db-grant-target") || {}).value || "";
        var btn = $("db-grant-submit");

        var valid = true;
        if (!userHost || userHost.indexOf("@") < 0) {
            SM.showError("db-grant-user-error", "Select an existing user"); valid = false;
        }
        if (!targetDb) {
            SM.showError("db-grant-target-error", "Select a target database"); valid = false;
        }
        if (!valid) return;

        var atIdx = userHost.indexOf("@");
        var user = userHost.substring(0, atIdx);
        var host = userHost.substring(atIdx + 1);

        SM.confirmDialog("Grant Database Access",
            "User: " + user + "@" + host + "\nTarget DB: " + targetDb + "\nPrivileges: ALL on " + targetDb + ".*")
            .then(function(ok) {
                if (!ok) return;
                SM.setLoading(btn, true);
                cockpit.spawn([DB_CMD, "grant-database", user, host, targetDb], { superuser: "require" })
                    .then(function() {
                        SM.setLoading(btn, false);
                        SM.logAction("DB_GRANT", user + "@" + host + " -> " + targetDb);
                        SM.showResult("db-grant-result", true,
                            "Granted ALL on " + targetDb + " to " + user + "@" + host);
                        var panel = $("db-grants-panel");
                        if (panel && panel.style.display === "block") showGrants(user, host);
                    })
                    .fail(function(err) {
                        SM.setLoading(btn, false);
                        SM.showResult("db-grant-result", false, "Failed: " + SM.errMsg(err));
                    });
            });
    }

    function revokeDatabase(user, host, dbName) {
        SM.confirmDialog("Revoke Database Access",
            "User: " + user + "@" + host + "\nDatabase: " + dbName +
            "\n\nThis removes all DB-level privileges on " + dbName + " for this user.")
            .then(function(ok) {
                if (!ok) return;
                cockpit.spawn([DB_CMD, "revoke-database", user, host, dbName], { superuser: "require" })
                    .then(function() {
                        SM.logAction("DB_REVOKE", user + "@" + host + " -> " + dbName);
                        SM.showResult("db-grant-result", true,
                            "Revoked " + dbName + " from " + user + "@" + host);
                        showGrants(user, host);
                    })
                    .fail(function(err) {
                        SM.showResult("db-grant-result", false, "Failed: " + SM.errMsg(err));
                    });
            });
    }

    function createUser() {
        SM.clearErrors("db-user");
        var username = ($("db-user-name") || {}).value || "";
        var host = ($("db-user-host") || {}).value || "";
        var password = ($("db-user-pass") || {}).value || "";
        var targetDb = ($("db-user-target") || {}).value || "";
        var btn = $("db-user-submit");
        username = username.trim();
        host = host.trim() || "localhost";

        var valid = true;
        if (!Validate.dbName(username)) { SM.showError("db-user-name-error", "Letters, digits, underscore only."); valid = false; }
        if (!host || host.length > 253) { SM.showError("db-user-host-error", "Invalid host"); valid = false; }
        if (!Validate.password(password)) { SM.showError("db-user-pass-error", "Minimum 8 characters"); valid = false; }
        if (!targetDb) { SM.showError("db-user-target-error", "Select a target database"); valid = false; }
        if (!valid) return;

        SM.confirmDialog("Create Database User",
            "User: " + username + "@" + host + "\nTarget DB: " + targetDb + "\nPrivileges: ALL on " + targetDb + ".*")
            .then(function(ok) {
                if (!ok) return;
                SM.setLoading(btn, true);
                cockpit.spawn([DB_CMD, "create-user", username, host, password, targetDb], { superuser: "require" })
                    .then(function() {
                        SM.setLoading(btn, false);
                        SM.logAction("DB_USER_CREATE", username + "@" + host + " -> " + targetDb);
                        SM.showResult("db-user-result", true, "User created: " + username + "@" + host);
                        SM.resetForm("db-user");
                        loadUsers();
                    })
                    .fail(function(err) {
                        SM.setLoading(btn, false);
                        SM.showResult("db-user-result", false, "Failed: " + SM.errMsg(err));
                    });
            });
    }

    function dropUser(user, host) {
        SM.confirmDialog("Drop Database User",
            "User: " + user + "@" + host + "\n\nThis will permanently remove the user and all privileges.")
            .then(function(ok) {
                if (!ok) return;
                cockpit.spawn([DB_CMD, "drop-user", user, host], { superuser: "require" })
                    .then(function() {
                        SM.logAction("DB_USER_DROP", user + "@" + host);
                        SM.showResult("db-user-result", true, "User dropped: " + user + "@" + host);
                        loadUsers();
                        var panel = $("db-grants-panel");
                        if (panel) panel.style.display = "none";
                    })
                    .fail(function(err) {
                        SM.showResult("db-user-result", false, "Failed: " + SM.errMsg(err));
                    });
            });
    }

    /* ══════════════════════════════════════
       Read-Only Query
       ══════════════════════════════════════ */

    function executeQuery() {
        SM.clearErrors("db-query");
        var sql = ($("db-query-input") || {}).value || "";
        var btn = $("db-query-submit");
        var resultContainer = $("db-query-result");
        sql = sql.trim();

        if (!sql) {
            SM.showError("db-query-input-error", "Enter a SQL query");
            return;
        }

        var upper = sql.replace(/^\s+/, "").toUpperCase();
        if (!/^(SELECT|SHOW|DESCRIBE|EXPLAIN)\s/.test(upper)) {
            SM.showError("db-query-input-error", "Only SELECT, SHOW, DESCRIBE, EXPLAIN allowed");
            return;
        }
        if (/INTO\s+(OUTFILE|DUMPFILE)|LOAD_FILE|SLEEP\s*\(|BENCHMARK\s*\(/i.test(sql)) {
            SM.showError("db-query-input-error", "Query contains forbidden pattern");
            return;
        }

        SM.setLoading(btn, true);
        cockpit.spawn([DB_CMD, "query", sql], { superuser: "require" })
            .then(function(output) {
                SM.setLoading(btn, false);
                if (!output.trim()) {
                    resultContainer.innerHTML = '<div class="result-box result-success">Query executed. No results.</div>';
                    return;
                }
                var lines = output.trim().split("\n");
                var html = '<div class="query-result-wrap"><table class="mgmt-table"><tbody>';
                lines.forEach(function(line) {
                    var cols = line.split("\t");
                    html += '<tr>';
                    cols.forEach(function(col) {
                        html += '<td>' + SM.escapeHtml(col) + '</td>';
                    });
                    html += '</tr>';
                });
                html += '</tbody></table></div>';
                resultContainer.innerHTML = html;
            })
            .fail(function(err) {
                SM.setLoading(btn, false);
                resultContainer.innerHTML = '<div class="result-box result-error">' + SM.escapeHtml(SM.errMsg(err)) + '</div>';
            });
    }

    /* ══════════════════════════════════════
       Initialization
       ══════════════════════════════════════ */

    function initDatabase() {
        loadDatabases();
        loadUsers();

        SM.bindSubmit("db-create-form", createDatabase);
        SM.bindSubmit("db-user-form", createUser);
        SM.bindSubmit("db-grant-form", grantDatabase);
        SM.bindSubmit("db-query-form", executeQuery);
        SM.bindClick("db-refresh", loadDatabases);
        SM.bindClick("db-user-refresh", loadUsers);
        SM.bindClick("db-grants-close", function() {
            var panel = $("db-grants-panel");
            if (panel) panel.style.display = "none";
        });
    }

    SM.registerModule("database", initDatabase);

})();
