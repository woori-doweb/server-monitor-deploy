/* Server Monitor - Firewall Management (firewalld) */
/* Depends on: utils.js (SM namespace) */

(function() {
    "use strict";

    if (!window.SM) { console.error("SM not loaded"); return; }

    var $ = SM.$;
    var Validate = SM.Validate;
    var PROTECTED_PORTS = SM.PROTECTED_PORTS || [19999, 3001, 9090];
    var PROTECTED_FW_SERVICES = ["ssh"];

    /* ══════════════════════════════════════
       Firewall Status
       ══════════════════════════════════════ */

    function loadFirewallStatus() {
        var portsContainer = $("fw-port-list");
        var svcsContainer = $("fw-service-list");
        if (!portsContainer || !svcsContainer) return;
        portsContainer.innerHTML = '<div class="muted loading">Loading...</div>';
        svcsContainer.innerHTML = '<div class="muted loading">Loading...</div>';

        cockpit.spawn(["firewall-cmd", "--list-ports"], { superuser: "require" })
            .then(function(output) {
                var ports = output.trim().split(/\s+/).filter(function(p) { return p; });
                renderPorts(ports, portsContainer);
            })
            .fail(function(err) {
                portsContainer.innerHTML = '<div class="result-box result-error">' + SM.escapeHtml(SM.errMsg(err)) + '</div>';
            });

        cockpit.spawn(["firewall-cmd", "--list-services"], { superuser: "require" })
            .then(function(output) {
                var services = output.trim().split(/\s+/).filter(function(s) { return s; });
                renderServices(services, svcsContainer);
            })
            .fail(function(err) {
                svcsContainer.innerHTML = '<div class="result-box result-error">' + SM.escapeHtml(SM.errMsg(err)) + '</div>';
            });

        loadZoneInfo();
    }

    function loadZoneInfo() {
        var el = $("fw-zone-info");
        if (!el) return;
        cockpit.spawn(["firewall-cmd", "--get-active-zones"], { superuser: "require" })
            .then(function(out) {
                el.textContent = out.trim().split("\n")[0] || "unknown";
            });
    }

    function renderPorts(ports, container) {
        if (ports.length === 0) {
            container.innerHTML = '<div class="muted">No ports opened</div>';
            return;
        }
        var html = '<table class="mgmt-table"><thead><tr><th>Port/Protocol</th><th>Actions</th></tr></thead><tbody>';
        ports.forEach(function(p) {
            var portNum = parseInt(p);
            var isProtected = PROTECTED_PORTS.indexOf(portNum) !== -1;
            var actions = isProtected
                ? '<span class="badge badge-warn">protected</span>'
                : '<button class="btn btn-sm btn-danger" data-remove-port="' + SM.escapeHtml(p) + '">Remove</button>';
            html += '<tr><td><code>' + SM.escapeHtml(p) + '</code></td><td>' + actions + '</td></tr>';
        });
        container.innerHTML = html + '</tbody></table>';

        container.querySelectorAll("[data-remove-port]").forEach(function(btn) {
            btn.addEventListener("click", function() {
                removePort(btn.getAttribute("data-remove-port"));
            });
        });
    }

    function renderServices(services, container) {
        if (services.length === 0) {
            container.innerHTML = '<div class="muted">No services allowed</div>';
            return;
        }
        var html = '<table class="mgmt-table"><thead><tr><th>Service</th><th>Actions</th></tr></thead><tbody>';
        services.forEach(function(s) {
            var isProtected = PROTECTED_FW_SERVICES.indexOf(s) !== -1;
            var actions = isProtected
                ? '<span class="badge badge-warn">protected</span>'
                : '<button class="btn btn-sm btn-danger" data-remove-svc="' + SM.escapeHtml(s) + '">Remove</button>';
            html += '<tr><td><code>' + SM.escapeHtml(s) + '</code></td><td>' + actions + '</td></tr>';
        });
        container.innerHTML = html + '</tbody></table>';

        container.querySelectorAll("[data-remove-svc]").forEach(function(btn) {
            btn.addEventListener("click", function() {
                removeService(btn.getAttribute("data-remove-svc"));
            });
        });
    }

    /* ══════════════════════════════════════
       Add / Remove
       ══════════════════════════════════════ */

    function addPort() {
        SM.clearErrors("fw-port");
        var port = ($("fw-port-input") || {}).value || "";
        var proto = ($("fw-proto-select") || {}).value || "tcp";
        var btn = $("fw-port-submit");
        port = port.trim();

        var portNum = parseInt(port, 10);
        if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
            SM.showError("fw-port-input-error", "Port must be 1-65535");
            return;
        }
        if (PROTECTED_PORTS.indexOf(portNum) !== -1) {
            SM.showError("fw-port-input-error", "Port " + portNum + " is protected (internal monitoring)");
            return;
        }

        var spec = portNum + "/" + proto;
        SM.confirmDialog("Add Firewall Port", "Port: " + spec + " (permanent)\nThis will allow incoming traffic on this port.")
            .then(function(ok) {
                if (!ok) return;
                SM.setLoading(btn, true);
                cockpit.spawn(["firewall-cmd", "--permanent", "--add-port=" + spec], { superuser: "require" })
                    .then(function() { return cockpit.spawn(["firewall-cmd", "--reload"], { superuser: "require" }); })
                    .then(function() {
                        SM.setLoading(btn, false);
                        SM.logAction("FW_PORT_ADD", spec);
                        SM.showResult("fw-result", true, "Port " + spec + " opened");
                        $("fw-port-input").value = "";
                        loadFirewallStatus();
                    })
                    .fail(function(err) {
                        SM.setLoading(btn, false);
                        SM.showResult("fw-result", false, "Failed: " + SM.errMsg(err));
                    });
            });
    }

    function removePort(spec) {
        var warn = "";
        if (spec.indexOf("80/") === 0 || spec.indexOf("443/") === 0) {
            warn = "\n\nWARNING: Removing HTTP/HTTPS port will break web access!";
        }
        SM.confirmDialog("Remove Firewall Port", "Port: " + spec + warn)
            .then(function(ok) {
                if (!ok) return;
                cockpit.spawn(["firewall-cmd", "--permanent", "--remove-port=" + spec], { superuser: "require" })
                    .then(function() { return cockpit.spawn(["firewall-cmd", "--reload"], { superuser: "require" }); })
                    .then(function() {
                        SM.logAction("FW_PORT_REMOVE", spec);
                        SM.showResult("fw-result", true, "Port " + spec + " removed");
                        loadFirewallStatus();
                    })
                    .fail(function(err) {
                        SM.showResult("fw-result", false, "Failed: " + SM.errMsg(err));
                    });
            });
    }

    function addService() {
        SM.clearErrors("fw-svc");
        var svc = ($("fw-svc-input") || {}).value || "";
        var btn = $("fw-svc-submit");
        svc = svc.trim();

        if (!svc || !/^[a-zA-Z0-9_-]{1,64}$/.test(svc)) {
            SM.showError("fw-svc-input-error", "Invalid service name");
            return;
        }

        SM.confirmDialog("Add Firewall Service", "Service: " + svc + " (permanent)")
            .then(function(ok) {
                if (!ok) return;
                SM.setLoading(btn, true);
                cockpit.spawn(["firewall-cmd", "--permanent", "--add-service=" + svc], { superuser: "require" })
                    .then(function() { return cockpit.spawn(["firewall-cmd", "--reload"], { superuser: "require" }); })
                    .then(function() {
                        SM.setLoading(btn, false);
                        SM.logAction("FW_SVC_ADD", svc);
                        SM.showResult("fw-result", true, "Service " + svc + " allowed");
                        $("fw-svc-input").value = "";
                        loadFirewallStatus();
                    })
                    .fail(function(err) {
                        SM.setLoading(btn, false);
                        SM.showResult("fw-result", false, "Failed: " + SM.errMsg(err));
                    });
            });
    }

    function removeService(svc) {
        if (svc === "http" || svc === "https") {
            SM.confirmDialog("WARNING: Remove " + svc, "Removing " + svc + " will break web access!\nAre you sure?")
                .then(function(ok) { if (ok) doRemoveService(svc); });
        } else {
            doRemoveService(svc);
        }
    }

    function doRemoveService(svc) {
        SM.confirmDialog("Remove Firewall Service", "Service: " + svc)
            .then(function(ok) {
                if (!ok) return;
                cockpit.spawn(["firewall-cmd", "--permanent", "--remove-service=" + svc], { superuser: "require" })
                    .then(function() { return cockpit.spawn(["firewall-cmd", "--reload"], { superuser: "require" }); })
                    .then(function() {
                        SM.logAction("FW_SVC_REMOVE", svc);
                        SM.showResult("fw-result", true, "Service " + svc + " removed");
                        loadFirewallStatus();
                    })
                    .fail(function(err) {
                        SM.showResult("fw-result", false, "Failed: " + SM.errMsg(err));
                    });
            });
    }

    /* ══════════════════════════════════════
       Initialization
       ══════════════════════════════════════ */

    function initFirewall() {
        loadFirewallStatus();
        SM.bindClick("fw-refresh", loadFirewallStatus);
        SM.bindSubmit("fw-port-form", addPort);
        SM.bindSubmit("fw-svc-form", addService);
    }

    SM.registerModule("firewall", initFirewall);

})();
