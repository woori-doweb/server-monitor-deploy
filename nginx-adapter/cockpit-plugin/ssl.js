/* Server Monitor - SSL Certificate Management */
/* Depends on: utils.js (SM namespace) */

(function() {
    "use strict";

    if (!window.SM) { console.error("SM not loaded"); return; }

    var $ = SM.$;
    var Validate = SM.Validate;
    var certAccordionId = 0;

    /* ══════════════════════════════════════
       Certificate Parsing (7 fields)
       ══════════════════════════════════════ */

    function parseCertbotOutput(output) {
        var certs = [];
        var current = null;
        output.split("\n").forEach(function(line) {
            var t = line.trim();
            if (t.indexOf("Certificate Name:") === 0) {
                if (current) certs.push(current);
                current = { name: "", domains: "", expiry: "", certPath: "", keyPath: "", serial: "", keyType: "" };
                current.name = t.split(":").slice(1).join(":").trim();
            }
            if (!current) return;
            if (t.indexOf("Domains:") === 0) current.domains = t.split(":").slice(1).join(":").trim();
            if (t.indexOf("Expiry Date:") === 0) current.expiry = t.split(":").slice(1).join(":").trim();
            if (t.indexOf("Certificate Path:") === 0) current.certPath = t.split(":").slice(1).join(":").trim();
            if (t.indexOf("Private Key Path:") === 0) current.keyPath = t.split(":").slice(1).join(":").trim();
            if (t.indexOf("Serial Number:") === 0) current.serial = t.split(":").slice(1).join(":").trim();
            if (t.indexOf("Key Type:") === 0) current.keyType = t.split(":").slice(1).join(":").trim();
        });
        if (current) certs.push(current);
        return certs;
    }

    function expiryInfo(expiryStr) {
        if (!expiryStr) return { days: -1, badge: '<span class="badge badge-inactive">unknown</span>' };
        var match = expiryStr.match(/(\d{4}-\d{2}-\d{2})/);
        if (!match) return { days: -1, badge: '<span class="badge badge-inactive">' + SM.escapeHtml(expiryStr.substring(0, 20)) + '</span>' };
        var expDate = new Date(match[1]);
        var now = new Date();
        var days = Math.ceil((expDate - now) / 86400000);
        var badge;
        if (days <= 7) badge = '<span class="badge badge-crit">' + days + 'd</span>';
        else if (days <= 30) badge = '<span class="badge badge-warn">' + days + 'd</span>';
        else badge = '<span class="badge badge-ok">' + days + 'd</span>';
        return { days: days, badge: badge, date: match[1] };
    }

    /* ══════════════════════════════════════
       Accordion Rendering
       ══════════════════════════════════════ */

    function loadCertificates() {
        var container = $("ssl-cert-list");
        if (!container) return;
        container.innerHTML = '<div class="muted loading">Loading...</div>';

        cockpit.spawn(["certbot", "certificates"], { superuser: "require" })
            .then(function(output) {
                var certs = parseCertbotOutput(output);
                renderAccordionList(certs, container);
            })
            .fail(function(err) {
                container.innerHTML = '<div class="result-box result-error">' + SM.escapeHtml(SM.errMsg(err)) + '</div>';
            });
    }

    function renderAccordionList(certs, container) {
        if (certs.length === 0) {
            container.innerHTML = '<div class="muted">No certificates found</div>';
            return;
        }

        // Sort: expiring soonest first
        certs.sort(function(a, b) {
            return expiryInfo(a.expiry).days - expiryInfo(b.expiry).days;
        });

        var html = "";
        certs.forEach(function(cert) {
            var id = "ssl-acc-" + (++certAccordionId);
            var info = expiryInfo(cert.expiry);
            var domainList = cert.domains.split(/\s+/).filter(function(d) { return d; });

            html += '<div class="accordion-card">' +
                '<div class="accordion-header" id="' + id + '" onclick="SM.toggleAccordion(\'' + id + '\')">' +
                    '<div class="accordion-title">' +
                        '<span class="chevron">▶</span>' +
                        '<code>' + SM.escapeHtml(cert.name) + '</code>' +
                        (domainList.length > 1 ? ' <span class="muted" style="font-size:0.7rem">+' + (domainList.length - 1) + ' domains</span>' : '') +
                    '</div>' +
                    '<div class="accordion-right">' +
                        info.badge +
                    '</div>' +
                '</div>' +
                '<div class="accordion-body">' +
                    '<div class="accordion-body-inner">' +
                        '<div class="accordion-detail">' +
                            '<div class="info-row"><span class="info-label">Domains</span><span>' + SM.escapeHtml(cert.domains) + '</span></div>' +
                            '<div class="info-row"><span class="info-label">Expiry</span><span>' + SM.escapeHtml(info.date || cert.expiry) + '</span></div>' +
                            '<div class="info-row"><span class="info-label">Key Type</span><span>' + SM.escapeHtml(cert.keyType || "—") + '</span></div>' +
                            '<div class="info-row"><span class="info-label">Serial</span><span style="font-size:0.7rem">' + SM.escapeHtml(cert.serial || "—") + '</span></div>' +
                            '<div class="info-row"><span class="info-label">Cert Path</span><span><code style="font-size:0.7rem">' + SM.escapeHtml(cert.certPath) + '</code></span></div>' +
                            '<div class="info-row"><span class="info-label">Key Path</span><span><code style="font-size:0.7rem">' + SM.escapeHtml(cert.keyPath) + '</code></span></div>' +
                        '</div>' +
                        '<div class="accordion-actions">' +
                            '<button class="btn btn-sm btn-primary" data-renew-cert="' + SM.escapeHtml(cert.name) + '">Renew</button>' +
                            '<button class="btn btn-sm btn-danger" data-delete-cert="' + SM.escapeHtml(cert.name) + '">Delete</button>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>';
        });
        container.innerHTML = html;

        container.querySelectorAll("[data-renew-cert]").forEach(function(btn) {
            btn.addEventListener("click", function(e) {
                e.stopPropagation();
                renewCert(btn.getAttribute("data-renew-cert"));
            });
        });
        container.querySelectorAll("[data-delete-cert]").forEach(function(btn) {
            btn.addEventListener("click", function(e) {
                e.stopPropagation();
                deleteCert(btn.getAttribute("data-delete-cert"));
            });
        });
    }

    /* ══════════════════════════════════════
       Timer Status
       ══════════════════════════════════════ */

    function loadTimerStatus() {
        var el = $("ssl-timer-status");
        if (!el) return;
        cockpit.spawn(["systemctl", "is-active", "certbot.timer"])
            .then(function(out) {
                el.innerHTML = out.trim() === "active"
                    ? '<span class="badge badge-ok">timer active</span>'
                    : '<span class="badge badge-warn">' + SM.escapeHtml(out.trim()) + '</span>';
            })
            .fail(function() {
                el.innerHTML = '<span class="badge badge-crit">timer missing</span>';
            });
    }

    /* ══════════════════════════════════════
       Renew Certificate (ActionChain)
       ══════════════════════════════════════ */

    function renewCert(certName) {
        SM.confirmDialog("Renew SSL Certificate", "Certificate: " + certName + "\nThis will renew via certbot and reload Apache.")
            .then(function(ok) {
                if (!ok) return;
                SM.runActionChain("ssl-action-result", [
                    {
                        label: "certbot renew --cert-name " + certName,
                        required: true,
                        fn: function() { return cockpit.spawn(["certbot", "renew", "--cert-name", certName], { superuser: "require" }); },
                        pendingAction: {
                            label: "nginx 리로드 (SSL 갱신 적용)",
                            trigger: "SSL 갱신: " + certName,
                            command: ["systemctl", "reload", "nginx"],
                            precheck: ["nginx", "-t"]
                        }
                    },
                    {
                        label: "nginx 문법 검사 (nginx -t)",
                        required: true,
                        fn: function() { return cockpit.spawn(["nginx", "-t"], { superuser: "require" }); }
                    },
                    {
                        label: "nginx 리로드",
                        required: false,
                        fn: function() { return cockpit.spawn(["systemctl", "reload", "nginx"], { superuser: "require" }); }
                    }
                ], function(result) {
                    if (result.success) SM.logAction("SSL_RENEW", certName);
                    loadCertificates();
                });
            });
    }

    /* ══════════════════════════════════════
       Delete Certificate (ActionChain)
       ══════════════════════════════════════ */

    function deleteCert(certName) {
        SM.confirmDialog("Delete SSL Certificate",
            "Certificate: " + certName +
            "\n\nWARNING: This permanently removes the certificate.\nAssociated VHost SSL configs may break.\nApache reload will be required.")
            .then(function(ok) {
                if (!ok) return;
                SM.runActionChain("ssl-action-result", [
                    {
                        label: "certbot delete --cert-name " + certName,
                        required: true,
                        fn: function() {
                            return cockpit.spawn(["certbot", "delete", "--cert-name", certName, "--non-interactive"], { superuser: "require" });
                        }
                    },
                    {
                        label: "nginx 문법 검사 (nginx -t)",
                        required: false,
                        fn: function() { return cockpit.spawn(["nginx", "-t"], { superuser: "require" }); },
                        pendingAction: {
                            label: "nginx 설정 수정 필요 (삭제된 인증서 참조)",
                            trigger: "SSL 삭제: " + certName,
                            command: ["nginx", "-t"],
                            service: "nginx"
                        }
                    },
                    {
                        label: "nginx 리로드",
                        required: false,
                        fn: function() { return cockpit.spawn(["systemctl", "reload", "nginx"], { superuser: "require" }); }
                    }
                ], function(result) {
                    if (result.success) SM.logAction("SSL_DELETE", certName);
                    loadCertificates();
                });
            });
    }

    /* ══════════════════════════════════════
       Dry Run
       ══════════════════════════════════════ */

    function dryRun() {
        var btn = $("ssl-dryrun-btn");
        SM.setLoading(btn, true);
        cockpit.spawn(["certbot", "renew", "--dry-run"], { superuser: "require" })
            .then(function(out) {
                SM.setLoading(btn, false);
                var lines = out.trim().split("\n");
                var summary = lines.filter(function(l) {
                    return l.indexOf("Congratulations") !== -1 || l.indexOf("simulating") !== -1 ||
                           l.indexOf("renewal") !== -1 || l.indexOf("failed") !== -1;
                });
                SM.showResult("ssl-action-result", true, "Dry-run:\n" + (summary.length > 0 ? summary.join("\n") : lines.slice(-5).join("\n")));
            })
            .fail(function(err) {
                SM.setLoading(btn, false);
                SM.showResult("ssl-action-result", false, "Dry-run failed: " + SM.errMsg(err));
            });
    }

    /* ══════════════════════════════════════
       Issue New Certificate (ActionChain)
       ══════════════════════════════════════ */

    function issueCert() {
        SM.clearErrors("ssl");
        var domain = ($("ssl-domain") || {}).value || "";
        var extra = ($("ssl-extra-domains") || {}).value || "";
        var method = ($("ssl-method") || {}).value || "nginx";
        var email = ($("ssl-email") || {}).value || "";
        var btn = $("ssl-issue-submit");
        domain = domain.trim();
        email = email.trim();

        if (!Validate.domain(domain)) {
            SM.showError("ssl-domain-error", "Invalid domain (e.g. api.example.com)");
            return;
        }

        // Build domain list
        var domains = [domain];
        if (extra) {
            extra.split(",").forEach(function(d) {
                d = d.trim();
                if (d && Validate.domain(d)) domains.push(d);
            });
        }

        if (!email) email = "admin@" + domain.split(".").slice(-2).join(".");

        var domainArgs = [];
        domains.forEach(function(d) { domainArgs.push("-d"); domainArgs.push(d); });

        var steps;
        if (method === "nginx") {
            steps = [
                {
                    label: "certbot --nginx " + domains.join(", "),
                    required: true,
                    fn: function() {
                        var cmd = ["certbot", "--nginx", "--non-interactive", "--agree-tos", "--email", email].concat(domainArgs);
                        return cockpit.spawn(cmd, { superuser: "require" });
                    }
                },
                {
                    label: "nginx 문법 검사 (nginx -t)",
                    required: true,
                    fn: function() { return cockpit.spawn(["nginx", "-t"], { superuser: "require" }); }
                },
                {
                    label: "nginx 리로드 (SSL 적용)",
                    required: false,
                    fn: function() { return cockpit.spawn(["systemctl", "reload", "nginx"], { superuser: "require" }); },
                    pendingAction: {
                        label: "nginx 리로드 (SSL 발급 적용)",
                        trigger: "SSL 발급: " + domain,
                        command: ["systemctl", "reload", "nginx"],
                        precheck: ["nginx", "-t"]
                    }
                }
            ];
        } else {
            steps = [
                {
                    label: "certbot certonly --standalone " + domains.join(", "),
                    required: true,
                    fn: function() {
                        var cmd = ["certbot", "certonly", "--standalone", "--non-interactive", "--agree-tos", "--email", email].concat(domainArgs);
                        return cockpit.spawn(cmd, { superuser: "require" });
                    }
                },
                {
                    label: "⚠ nginx VHost에 SSL 설정 수동 추가 필요",
                    required: false,
                    fn: function() {
                        return cockpit.spawn(["nginx", "-t"], { superuser: "require" });
                    },
                    pendingAction: {
                        label: "nginx VHost SSL 설정 + 리로드 필요",
                        trigger: "SSL standalone 발급: " + domain,
                        command: ["systemctl", "reload", "nginx"],
                        precheck: ["nginx", "-t"]
                    }
                }
            ];
        }

        var domainStr = domains.join(", ");
        SM.confirmDialog("Issue SSL Certificate",
            "Domains: " + domainStr + "\nMethod: " + method + "\nEmail: " + email)
            .then(function(ok) {
                if (!ok) return;
                SM.setLoading(btn, true);
                SM.runActionChain("ssl-issue-chain", steps, function(result) {
                    SM.setLoading(btn, false);
                    if (result.success) {
                        SM.logAction("SSL_ISSUE", domainStr + " (" + method + ")");
                        SM.resetForm("ssl-issue");
                        updateDepPreview();
                    }
                    loadCertificates();
                });
            });
    }

    /* ══════════════════════════════════════
       Dependency Preview
       ══════════════════════════════════════ */

    function updateDepPreview() {
        var method = ($("ssl-method") || {}).value || "nginx";
        var steps;

        if (method === "nginx") {
            steps = [
                { label: "certbot --nginx -d {domain}", auto: true },
                { label: "nginx VHost에 SSL 지시어 자동 추가", auto: true },
                { label: "nginx 문법 검사 (nginx -t)", auto: true },
                { label: "nginx 리로드", auto: true, duration: "30-60초" }
            ];
        } else {
            steps = [
                { label: "certbot certonly --standalone -d {domain}", auto: true },
                { label: "Port 80 일시 점유 (인증 검증)", auto: true },
                { label: "nginx VHost SSL 설정 추가", auto: false },
                { label: "nginx 리로드", auto: false, duration: "30-60초" }
            ];
        }
        SM.showDependencyPreview("ssl-dep-preview", steps);
    }

    /* ══════════════════════════════════════
       Initialization
       ══════════════════════════════════════ */

    function initSSL() {
        loadCertificates();
        loadTimerStatus();

        SM.bindClick("ssl-refresh", function() { loadCertificates(); loadTimerStatus(); });
        SM.bindClick("ssl-dryrun-btn", dryRun);
        SM.bindSubmit("ssl-issue-form", issueCert);
        SM.bindChange("ssl-method", updateDepPreview);

        updateDepPreview();
    }

    SM.registerModule("ssl", initSSL);

})();
