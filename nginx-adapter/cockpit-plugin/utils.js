/* Server Monitor - Shared Utilities */
/* Global namespace: window.SM */

(function() {
    "use strict";

    var SM = window.SM = {};

    SM.$ = function(id) { return document.getElementById(id); };

    /* ── Protected Resources ── */

    // 보조 서버 (Ubuntu/nginx/ufw/Docker)
    SM.PROTECTED_VHOSTS = ["monitor-nginx.example.com", "app.example.com"]; // nginx server_name
    SM.PROTECTED_ACCOUNTS = ["root", "monitor", "dev260427", "appuser"];
    SM.PROTECTED_SERVICES = ["ssh", "ufw", "duckdns-update.timer"];
    SM.PROTECTED_PORTS = [19999, 3011, 9090, 22, 80, 443]; // Netdata, Uptime Kuma, Cockpit, SSH, HTTP, HTTPS
    SM.SYSTEM_DB_USERS = ["postgres"]; // 향후 PostgreSQL 도입 시

    /* ── Module Registration ── */

    SM.modules = {};
    SM.registerModule = function(name, initFn) {
        SM.modules[name] = { init: initFn, initialized: false };
    };
    SM.initModule = function(name) {
        var mod = SM.modules[name];
        if (mod && !mod.initialized) {
            mod.init();
            mod.initialized = true;
        }
    };

    /* ── Validation ── */

    SM.Validate = {
        domain: function(s) {
            if (!s || s.length > 253) return false;
            return /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,}$/.test(s);
        },
        port: function(s) {
            var n = parseInt(s, 10);
            return !isNaN(n) && n >= 1024 && n <= 65535;
        },
        username: function(s) {
            return /^[a-z_][a-z0-9_-]{2,30}$/.test(s);
        },
        sshKey: function(s) {
            if (!s || s.length > 8192) return false;
            var trimmed = s.trim();
            if (trimmed.indexOf("\n") !== -1) return false;
            return /^(ssh-rsa|ssh-ed25519|ecdsa-sha2-nistp\d+)\s+\S+/.test(trimmed);
        },
        password: function(s) {
            return s && s.length >= 8;
        },
        dbName: function(s) {
            return /^[a-zA-Z0-9_]{1,64}$/.test(s);
        }
    };

    /* ── HTML Escape ── */

    SM.escapeHtml = function(str) {
        var div = document.createElement("div");
        div.textContent = String(str);
        return div.innerHTML;
    };

    /* ── Confirmation Dialog ── */

    SM.confirmDialog = function(title, message) {
        return new Promise(function(resolve) {
            var overlay = document.createElement("div");
            overlay.className = "modal-overlay";

            var modal = document.createElement("div");
            modal.className = "modal";
            modal.setAttribute("role", "dialog");
            modal.setAttribute("aria-modal", "true");

            var h3 = document.createElement("h3");
            h3.className = "modal-title";
            h3.textContent = title;

            var body = document.createElement("div");
            body.className = "modal-body";
            body.textContent = message;

            var actions = document.createElement("div");
            actions.className = "modal-actions";

            var cancelBtn = document.createElement("button");
            cancelBtn.className = "btn";
            cancelBtn.textContent = "Cancel";

            var okBtn = document.createElement("button");
            okBtn.className = "btn btn-primary";
            okBtn.textContent = "Confirm";

            actions.appendChild(cancelBtn);
            actions.appendChild(okBtn);
            modal.appendChild(h3);
            modal.appendChild(body);
            modal.appendChild(actions);
            overlay.appendChild(modal);
            document.body.appendChild(overlay);

            var resolved = false;
            function cleanup(result) {
                if (resolved) return;
                resolved = true;
                document.removeEventListener("keydown", onKey);
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                resolve(result);
            }

            function onKey(e) {
                if (e.key === "Escape") cleanup(false);
                if (e.key === "Enter") cleanup(true);
            }

            cancelBtn.addEventListener("click", function() { cleanup(false); });
            okBtn.addEventListener("click", function() { cleanup(true); });
            overlay.addEventListener("click", function(e) {
                if (e.target === overlay) cleanup(false);
            });
            document.addEventListener("keydown", onKey);
            okBtn.focus();
        });
    };

    /* ── Typed Confirmation Dialog ── */
    /* For destructive operations on critical resources — user must type
       the exact name/value to confirm (DROP-style guard). */

    SM.typedConfirmDialog = function(title, message, expectedValue, placeholder) {
        return new Promise(function(resolve) {
            var overlay = document.createElement("div");
            overlay.className = "modal-overlay";
            var modal = document.createElement("div");
            modal.className = "modal";
            modal.setAttribute("role", "dialog");
            modal.setAttribute("aria-modal", "true");

            var h3 = document.createElement("h3");
            h3.className = "modal-title";
            h3.textContent = title;

            var body = document.createElement("div");
            body.className = "modal-body";
            body.textContent = message;

            var hint = document.createElement("div");
            hint.style.cssText = "margin-top:0.5rem;font-size:0.75rem;color:#fbbf24";
            hint.textContent = "Type \"" + expectedValue + "\" to enable Confirm";

            var input = document.createElement("input");
            input.type = "text";
            input.className = "form-input";
            input.placeholder = placeholder || expectedValue;
            input.style.cssText = "margin-top:0.5rem;width:100%";
            input.autocomplete = "off";

            var actions = document.createElement("div");
            actions.className = "modal-actions";
            var cancelBtn = document.createElement("button");
            cancelBtn.className = "btn";
            cancelBtn.textContent = "Cancel";
            var okBtn = document.createElement("button");
            okBtn.className = "btn btn-danger";
            okBtn.textContent = "Confirm";
            okBtn.disabled = true;

            actions.appendChild(cancelBtn);
            actions.appendChild(okBtn);
            modal.appendChild(h3);
            modal.appendChild(body);
            modal.appendChild(hint);
            modal.appendChild(input);
            modal.appendChild(actions);
            overlay.appendChild(modal);
            document.body.appendChild(overlay);

            var resolved = false;
            function cleanup(result) {
                if (resolved) return;
                resolved = true;
                document.removeEventListener("keydown", onKey);
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                resolve(result);
            }
            function onKey(e) {
                if (e.key === "Escape") cleanup(false);
                if (e.key === "Enter" && !okBtn.disabled) cleanup(true);
            }
            input.addEventListener("input", function() {
                okBtn.disabled = (input.value !== expectedValue);
            });
            cancelBtn.addEventListener("click", function() { cleanup(false); });
            okBtn.addEventListener("click", function() { cleanup(true); });
            overlay.addEventListener("click", function(e) {
                if (e.target === overlay) cleanup(false);
            });
            document.addEventListener("keydown", onKey);
            input.focus();
        });
    };

    /* ── UI Helpers ── */

    SM.showResult = function(containerId, success, message) {
        var el = SM.$(containerId);
        if (!el) return;
        if (success) {
            el.innerHTML = '<div class="result-box result-success">' + SM.escapeHtml(message) + '</div>';
            setTimeout(function() { if (el) el.innerHTML = ""; }, 15000);
        } else {
            el.innerHTML = '<div class="result-box result-error">' + SM.escapeHtml(message) +
                '<button class="result-close" title="Close">&times;</button></div>';
            el.querySelector(".result-close").addEventListener("click", function() { el.innerHTML = ""; });
        }
    };

    SM.setLoading = function(btn, loading) {
        if (!btn) return;
        if (loading) {
            btn.disabled = true;
            btn.dataset.originalText = btn.textContent;
            btn.innerHTML = '<span class="spinner"></span> Processing...';
        } else {
            btn.disabled = false;
            btn.textContent = btn.dataset.originalText || "Submit";
        }
    };

    SM.showError = function(id, msg) {
        var el = SM.$(id);
        if (el) el.textContent = msg;
    };

    SM.clearErrors = function(prefix) {
        document.querySelectorAll("[id^='" + prefix + "'][id$='-error']").forEach(function(el) {
            el.textContent = "";
        });
    };

    SM.errMsg = function(err) {
        if (!err) return "Unknown error";
        return err.message || err.problem || String(err);
    };

    SM.resetForm = function(prefix) {
        var form = SM.$(prefix + "-form");
        if (form) form.reset();
    };

    SM.validSelectedUser = function(user, errorId) {
        if (!user) {
            if (errorId) SM.showError(errorId, "Select an account");
            return false;
        }
        if (!SM.Validate.username(user)) {
            if (errorId) SM.showError(errorId, "Invalid account name");
            return false;
        }
        return true;
    };

    SM.sanitizeFilename = function(domain) {
        return domain.replace(/[^a-zA-Z0-9.-]/g, "").replace(/\./g, "-");
    };

    /* ── Audit Logging ── */

    SM.logAction = function(action, details) {
        cockpit.spawn(["date", "-u", "+%Y-%m-%dT%H:%M:%S%z"])
            .then(function(ts) {
                var entry = JSON.stringify({
                    ts: ts.trim(),
                    actor: "monitor",
                    action: action,
                    target: String(details).replace(/[\r\n]/g, " "),
                    result: "success"
                });
                cockpit.spawn(["tee", "-a", "/home/monitor/logs/management.log"],
                    { superuser: "require" }).input(entry + "\n")
                    .fail(function(err) {
                        SM.showResult("vhost-result", false, "Audit log write failed: " + SM.errMsg(err));
                        console.warn("Audit log write failed:", err);
                    });
            })
            .fail(function() {
                var entry = JSON.stringify({
                    ts: new Date().toISOString(),
                    actor: "monitor",
                    action: action,
                    target: String(details).replace(/[\r\n]/g, " "),
                    result: "success"
                });
                cockpit.spawn(["tee", "-a", "/home/monitor/logs/management.log"],
                    { superuser: "require" }).input(entry + "\n");
            });
    };

    /* ── Event Binding Helpers ── */

    SM.bindSubmit = function(id, fn) {
        var el = SM.$(id);
        if (el) el.addEventListener("submit", function(e) { e.preventDefault(); fn(); });
    };
    SM.bindClick = function(id, fn) {
        var el = SM.$(id);
        if (el) el.addEventListener("click", fn);
    };
    SM.bindChange = function(id, fn) {
        var el = SM.$(id);
        if (el) el.addEventListener("change", fn);
    };

    /* ── Sub-tab Navigation ── */

    SM.initSubTabs = function() {
        var btns = document.querySelectorAll(".subtab-btn");
        btns.forEach(function(btn) {
            btn.addEventListener("click", function() {
                var target = btn.getAttribute("data-subtab");
                btns.forEach(function(b) { b.classList.remove("active"); });
                document.querySelectorAll(".subtab-content").forEach(function(c) {
                    c.classList.remove("active");
                });
                btn.classList.add("active");
                var el = document.getElementById("subtab-" + target);
                if (el) el.classList.add("active");
                SM.initModule(target);
            });
        });
    };

    /* ── Shared Account Data ── */

    SM.accounts = [];

    SM.populateAccountSelectors = function(selectorIds) {
        selectorIds.forEach(function(id) {
            var sel = SM.$(id);
            if (!sel) return;
            var prev = sel.value;
            sel.innerHTML = '<option value="">-- Select Account --</option>';
            SM.accounts.forEach(function(a) {
                var opt = document.createElement("option");
                opt.value = a.name;
                opt.textContent = a.name + " (uid:" + a.uid + ")";
                sel.appendChild(opt);
            });
            if (prev) sel.value = prev;
        });
    };

    /* ── Action Chain ── */

    var chainCounter = 0;
    SM.runActionChain = function(containerId, steps, callback) {
        var container = SM.$(containerId);
        if (!container) return;
        var prefix = "ac-" + (++chainCounter) + "-";

        var html = '<div class="action-chain">';
        steps.forEach(function(step, i) {
            html += '<div class="chain-step step-pending" id="' + prefix + i + '">' +
                '<span class="chain-icon">○</span> ' +
                '<span class="chain-label">' + SM.escapeHtml(step.label) + '</span>' +
                '<span class="chain-status"></span></div>';
        });
        container.innerHTML = html + '</div>';

        var idx = 0;
        function runNext() {
            if (idx >= steps.length) {
                if (callback) callback({ success: true });
                return;
            }
            var step = steps[idx];
            var el = document.getElementById(prefix + idx);
            if (el) { el.className = "chain-step step-running"; el.querySelector(".chain-icon").textContent = "◉"; }

            step.fn()
                .then(function(result) {
                    if (el) {
                        el.className = "chain-step step-ok";
                        el.querySelector(".chain-icon").textContent = "✓";
                        var msg = typeof result === "string" ? result.trim().split("\n").pop().substring(0, 60) : "";
                        if (msg) el.querySelector(".chain-status").textContent = msg;
                    }
                    idx++;
                    runNext();
                })
                .fail(function(err) {
                    if (el) {
                        el.className = "chain-step step-fail";
                        el.querySelector(".chain-icon").textContent = "✗";
                        el.querySelector(".chain-status").textContent = SM.errMsg(err).substring(0, 80);
                    }
                    if (step.required !== false) {
                        for (var j = idx + 1; j < steps.length; j++) {
                            var sk = document.getElementById(prefix + j);
                            if (sk) { sk.className = "chain-step step-skip"; sk.querySelector(".chain-icon").textContent = "–"; }
                        }
                        if (step.pendingAction) SM.addPending(step.pendingAction);
                        if (callback) callback({ success: false, failedStep: idx, error: err });
                    } else {
                        idx++;
                        runNext();
                    }
                });
        }
        runNext();
    };

    /* ── Pending Actions ── */

    SM.pendingActions = [];
    var pendingIdCounter = 0;

    SM.addPending = function(action) {
        action.id = action.id || "pa-" + (++pendingIdCounter);
        action.ts = Date.now();
        SM.pendingActions.push(action);
        SM.renderPendingBanner();
    };

    SM.resolvePending = function(id) {
        var action = SM.pendingActions.find(function(a) { return a.id === id; });
        if (!action) return;

        var precheck = action.precheck
            ? cockpit.spawn(action.precheck, { superuser: "require" })
            : { then: function(fn) { fn(""); return this; }, fail: function() { return this; } };

        precheck.then(function() {
            cockpit.spawn(action.command, { superuser: "require" })
                .then(function() {
                    SM.pendingActions = SM.pendingActions.filter(function(a) { return a.id !== id; });
                    SM.logAction("PENDING_RESOLVED", action.label);
                    SM.renderPendingBanner();
                })
                .fail(function(err) {
                    SM.showResult("pending-result", false, action.label + " failed: " + SM.errMsg(err));
                });
        }).fail(function(err) {
            SM.showResult("pending-result", false, "Pre-check failed: " + SM.errMsg(err));
        });
    };

    SM.dismissPending = function(id) {
        SM.pendingActions = SM.pendingActions.filter(function(a) { return a.id !== id; });
        SM.renderPendingBanner();
    };

    SM.renderPendingBanner = function() {
        var container = SM.$("pending-actions-banner");
        if (!container) return;
        if (SM.pendingActions.length === 0) {
            container.innerHTML = "";
            container.style.display = "none";
            return;
        }
        container.style.display = "block";
        var html = '<div class="pending-banner">' +
            '<div class="pending-banner-header">' +
            '<span class="pending-banner-title">⚠ 보류 중인 필수 작업 (' + SM.pendingActions.length + ')</span>' +
            '<button class="btn btn-sm" id="pending-apply-all">Apply All</button></div>';
        SM.pendingActions.forEach(function(a) {
            html += '<div class="pending-item">' +
                '<div><span>' + SM.escapeHtml(a.label) + '</span><br><span class="pending-trigger">' + SM.escapeHtml(a.trigger || "") + '</span></div>' +
                '<div><button class="btn btn-sm btn-primary" data-resolve-pending="' + a.id + '">실행</button> ' +
                '<button class="btn btn-sm" data-dismiss-pending="' + a.id + '">무시</button></div></div>';
        });
        html += '<div id="pending-result"></div></div>';
        container.innerHTML = html;

        container.querySelectorAll("[data-resolve-pending]").forEach(function(btn) {
            btn.addEventListener("click", function() { SM.resolvePending(btn.getAttribute("data-resolve-pending")); });
        });
        container.querySelectorAll("[data-dismiss-pending]").forEach(function(btn) {
            btn.addEventListener("click", function() { SM.dismissPending(btn.getAttribute("data-dismiss-pending")); });
        });
        var applyAll = SM.$("pending-apply-all");
        if (applyAll) {
            applyAll.addEventListener("click", function() {
                SM.pendingActions.slice().forEach(function(a) { SM.resolvePending(a.id); });
            });
        }
    };

    /* ── Dependency Preview ── */

    SM.showDependencyPreview = function(containerId, steps) {
        var el = SM.$(containerId);
        if (!el) return;
        if (!steps || steps.length === 0) { el.innerHTML = ""; return; }
        var html = '<div class="dep-preview"><div class="dep-preview-title">실행 예정 작업 체인</div>';
        steps.forEach(function(s, i) {
            var tag = s.auto ? '<span class="dep-auto">auto</span>' : '<span class="dep-manual">manual</span>';
            html += '<div class="dep-step"><span class="dep-num">' + (i + 1) + '.</span> ' +
                SM.escapeHtml(s.label) + ' ' + tag + '</div>';
        });
        if (steps.length > 0 && steps[steps.length - 1].duration) {
            html += '<div class="dep-step" style="margin-top:0.25rem"><span class="dep-num">⏱</span> 예상 소요: ' + steps[steps.length - 1].duration + '</div>';
        }
        el.innerHTML = html + '</div>';
    };

    /* ── Accordion Helper ── */

    SM.toggleAccordion = function(headerId) {
        var header = document.getElementById(headerId);
        if (!header) return;
        var body = header.nextElementSibling;
        if (!body) return;
        var isOpen = header.classList.contains("open");
        header.classList.toggle("open");
        body.classList.toggle("open");
    };

    /* ── Init ── */

    SM.ensureLogDir = function() {
        cockpit.spawn(["mkdir", "-p", "/home/monitor/logs"], { superuser: "require" })
            .fail(function(err) { console.warn("Log dir check failed:", err); });
    };

})();
