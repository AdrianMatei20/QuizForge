-- Runs once, when the postgres volume is first initialised.
-- e2e tests use their own database so they can never wipe development data.
CREATE DATABASE quizforge_test;
