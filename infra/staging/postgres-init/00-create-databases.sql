-- Roda UMA vez, na criação do volume do Postgres (docker-entrypoint-initdb.d).
-- Um banco por serviço (ADR-001 §5.1). A role da aplicação e as permissões
-- vêm depois das migrations — ver deploy.sh.
CREATE DATABASE identity;
CREATE DATABASE inventory;
CREATE DATABASE clinical;
CREATE DATABASE reporting;
