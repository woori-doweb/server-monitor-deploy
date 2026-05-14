module.exports = {
  apps: [{
    name: "uptime-kuma",
    script: "server/server.js",
    cwd: "/home/monitor/uptime-kuma",
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: "300M",
    env: {
      NODE_ENV: "production",
      UPTIME_KUMA_PORT: 3001,
      UPTIME_KUMA_HOST: "127.0.0.1"
    },
    error_file: "/home/monitor/logs/uptime-kuma-error.log",
    out_file: "/home/monitor/logs/uptime-kuma-out.log",
    time: true
  }]
};
