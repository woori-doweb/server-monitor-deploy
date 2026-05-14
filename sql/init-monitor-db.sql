-- server-monitor: MariaDB 모니터링 계정 생성 예시
-- install.sh가 .env 값으로 자동 생성합니다.
-- 수동 실행 시 비밀번호와 DB 이름을 수정하세요.

CREATE USER IF NOT EXISTS 'monitor_db'@'localhost'
  IDENTIFIED BY '<PASSWORD>';

GRANT USAGE ON *.* TO 'monitor_db'@'localhost';
GRANT REPLICATION CLIENT ON *.* TO 'monitor_db'@'localhost';
GRANT PROCESS ON *.* TO 'monitor_db'@'localhost';

-- GRANT SELECT ON `your_db`.* TO 'monitor_db'@'localhost';

GRANT SELECT ON `performance_schema`.* TO 'monitor_db'@'localhost';

FLUSH PRIVILEGES;
