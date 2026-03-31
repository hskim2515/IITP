--
-- PostgreSQL database dump
--

-- Dumped from database version 17.4 (Debian 17.4-1.pgdg120+2)
-- Dumped by pg_dump version 17.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';
SET default_table_access_method = heap;

-- ============================================================
-- 0. DROP IF EXISTS (기존 객체 제거)
-- ============================================================

DROP TABLE IF EXISTS public.vehicle_type_parameter CASCADE;
DROP TABLE IF EXISTS public.vehicle_type_model CASCADE;
DROP TABLE IF EXISTS public.vehicle_type CASCADE;

DROP SEQUENCE IF EXISTS public.vehicle_type_id_seq;
DROP SEQUENCE IF EXISTS public.vehicle_type_model_id_seq;
DROP SEQUENCE IF EXISTS public.vehicle_type_parameter_id_seq;

-- ============================================================
-- 1. SEQUENCES (모든 시퀀스를 먼저 생성)
-- ============================================================

CREATE SEQUENCE public.vehicle_type_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.vehicle_type_id_seq OWNER TO postgres;

CREATE SEQUENCE public.vehicle_type_model_id_seq
    AS bigint
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.vehicle_type_model_id_seq OWNER TO postgres;

CREATE SEQUENCE public.vehicle_type_parameter_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.vehicle_type_parameter_id_seq OWNER TO postgres;

-- ============================================================
-- 2. TABLES (시퀀스 생성 후 테이블 생성)
-- ============================================================

CREATE TABLE public.vehicle_type (
    id bigint NOT NULL DEFAULT nextval('public.vehicle_type_id_seq'::regclass),
    name character varying(255) NOT NULL,
    v2x character varying(255) DEFAULT 'off',
    drt character varying(255) DEFAULT '0',
    max_pax character varying(255) DEFAULT '1',
    vehicle_id character varying(255)
);

ALTER TABLE public.vehicle_type OWNER TO postgres;

CREATE TABLE public.vehicle_type_model (
    id bigint NOT NULL DEFAULT nextval('public.vehicle_type_model_id_seq'::regclass),
    color character varying(255),
    file_name character varying(255),
    file_path character varying(255),
    name character varying(255),
    length character varying(255),
    vehicle_type_id bigint
);

ALTER TABLE public.vehicle_type_model OWNER TO postgres;

CREATE TABLE public.vehicle_type_parameter (
    id bigint NOT NULL DEFAULT nextval('public.vehicle_type_parameter_id_seq'::regclass),
    vehicle_type_id bigint NOT NULL,
    parameter_name character varying(255) NOT NULL,
    mean character varying(255),
    sd character varying(255),
    min character varying(255),
    max character varying(255),
    dist character varying(255)
);

ALTER TABLE public.vehicle_type_parameter OWNER TO postgres;

-- ============================================================
-- 3. SEQUENCE OWNED BY (테이블 생성 후 소유권 설정)
-- ============================================================

ALTER SEQUENCE public.vehicle_type_id_seq OWNED BY public.vehicle_type.id;
ALTER SEQUENCE public.vehicle_type_model_id_seq OWNED BY public.vehicle_type_model.id;
ALTER SEQUENCE public.vehicle_type_parameter_id_seq OWNED BY public.vehicle_type_parameter.id;

-- ============================================================
-- 4. PRIMARY KEY CONSTRAINTS
-- ============================================================

ALTER TABLE ONLY public.vehicle_type
    ADD CONSTRAINT vehicle_type_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.vehicle_type_model
    ADD CONSTRAINT vehicle_type_model_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.vehicle_type_parameter
    ADD CONSTRAINT vehicle_type_parameter_pkey PRIMARY KEY (id);

-- ============================================================
-- 5. FOREIGN KEY CONSTRAINTS
-- ============================================================

ALTER TABLE ONLY public.vehicle_type_parameter
    ADD CONSTRAINT fk_vehicle_type FOREIGN KEY (vehicle_type_id) REFERENCES public.vehicle_type(id);

ALTER TABLE ONLY public.vehicle_type_model
    ADD CONSTRAINT vehicle_type_model_vehicle_type_id_fkey FOREIGN KEY (vehicle_type_id) REFERENCES public.vehicle_type(id);

-- ============================================================
-- 6. SAMPLE DATA
-- ============================================================

-- vehicle_type: id, name, v2x, drt, max_pax, vehicle_id
INSERT INTO public.vehicle_type VALUES (1, '승용차',  'off', '0', '5',  'CAR');
INSERT INTO public.vehicle_type VALUES (2, '택시',    'on',  '1', '4',  'TAXI');
INSERT INTO public.vehicle_type VALUES (3, '버스',    'on',  '1', '45', 'BUS');
INSERT INTO public.vehicle_type VALUES (4, '트럭',    'off', '0', '2',  'TRUCK');
INSERT INTO public.vehicle_type VALUES (5, '이륜차',  'off', '0', '1',  'MOTO');

-- vehicle_type_model: id, color, file_name, file_path, name, length, vehicle_type_id
INSERT INTO public.vehicle_type_model VALUES (1, '#3a86ff', 'model_12.glb',         '/models/model_12.glb',         '승용차 기본', '4.5',  1);
INSERT INTO public.vehicle_type_model VALUES (2, '#ef0000', 'CesiumMilkTruck3.glb', '/models/CesiumMilkTruck3.glb', '택시 기본',   '4.8',  2);
INSERT INTO public.vehicle_type_model VALUES (3, '#2ec4b6', 'CesiumMilkTruck.glb',  '/models/CesiumMilkTruck.glb',  '버스 기본',   '12.0', 3);
INSERT INTO public.vehicle_type_model VALUES (4, '#f4a261', 'CesiumMilkTruck.glb',  '/models/CesiumMilkTruck.glb',  '트럭 기본',   '8.0',  4);
INSERT INTO public.vehicle_type_model VALUES (5, '#8338ec', 'model_12.glb',         '/models/model_12.glb',         '이륜차 기본', '2.0',  5);

-- vehicle_type_parameter: id, vehicle_type_id, parameter_name, mean, sd, min, max, dist

-- 승용차 (id=1)
INSERT INTO public.vehicle_type_parameter VALUES (1,  1, 'veh_len',        '4.5',    '0.3',   '3.5',   '5.5',   'Normal');
INSERT INTO public.vehicle_type_parameter VALUES (2,  1, 'jamgap',         '1.5',    '0.2',   '1.0',   '2.0',   'LogNormal');
INSERT INTO public.vehicle_type_parameter VALUES (3,  1, 'vf',             '110',    '10',    '90',    '130',   'Normal');
INSERT INTO public.vehicle_type_parameter VALUES (4,  1, 'reaction_time',  '1.2',    '0.1',   '1.0',   '1.5',   'LogNormal');
INSERT INTO public.vehicle_type_parameter VALUES (5,  1, 'max_acc',        '3.0',    '0.5',   '2.5',   '3.5',   'Normal');
INSERT INTO public.vehicle_type_parameter VALUES (6,  1, 'max_dec',        '-5.0',   '0.3',   '-6.0',  '-4.0',  'Normal');
INSERT INTO public.vehicle_type_parameter VALUES (7,  1, 'lc_param1',      '0.015',  '0.01',  '0.005', '0.03',  'Normal');
INSERT INTO public.vehicle_type_parameter VALUES (8,  1, 'lc_param2',      '0.045',  '0.015', '0.02',  '0.07',  'Normal');
INSERT INTO public.vehicle_type_parameter VALUES (9,  1, 'lc_sensitivity', '0.0025', '1.5',   '0.001', '0.05',  'LogNormal');

-- 택시 (id=2)
INSERT INTO public.vehicle_type_parameter VALUES (10, 2, 'veh_len',        '4.8',    '0.2',   '4.5',   '5.2',   'Normal');
INSERT INTO public.vehicle_type_parameter VALUES (11, 2, 'jamgap',         '1.4',    '0.2',   '1.0',   '1.8',   'LogNormal');
INSERT INTO public.vehicle_type_parameter VALUES (12, 2, 'vf',             '110',    '10',    '90',    '130',   'Normal');
INSERT INTO public.vehicle_type_parameter VALUES (13, 2, 'reaction_time',  '1.1',    '0.1',   '0.9',   '1.4',   'LogNormal');
INSERT INTO public.vehicle_type_parameter VALUES (14, 2, 'max_acc',        '3.2',    '0.5',   '2.7',   '3.8',   'Normal');
INSERT INTO public.vehicle_type_parameter VALUES (15, 2, 'max_dec',        '-5.2',   '0.3',   '-6.0',  '-4.5',  'Normal');
INSERT INTO public.vehicle_type_parameter VALUES (16, 2, 'lc_param1',      '0.018',  '0.01',  '0.007', '0.035', 'Normal');
INSERT INTO public.vehicle_type_parameter VALUES (17, 2, 'lc_param2',      '0.05',   '0.015', '0.025', '0.08',  'Normal');
INSERT INTO public.vehicle_type_parameter VALUES (18, 2, 'lc_sensitivity', '0.003',  '1.5',   '0.001', '0.06',  'LogNormal');

-- 버스 (id=3)
INSERT INTO public.vehicle_type_parameter VALUES (19, 3, 'veh_len',        '12.0',   '0.5',   '11.0',  '13.0',  'Normal');
INSERT INTO public.vehicle_type_parameter VALUES (20, 3, 'jamgap',         '2.0',    '0.3',   '1.5',   '2.5',   'LogNormal');
INSERT INTO public.vehicle_type_parameter VALUES (21, 3, 'vf',             '80',     '5',     '70',    '90',    'Normal');
INSERT INTO public.vehicle_type_parameter VALUES (22, 3, 'reaction_time',  '1.5',    '0.15',  '1.2',   '1.8',   'LogNormal');
INSERT INTO public.vehicle_type_parameter VALUES (23, 3, 'max_acc',        '1.5',    '0.3',   '1.0',   '2.0',   'Normal');
INSERT INTO public.vehicle_type_parameter VALUES (24, 3, 'max_dec',        '-4.0',   '0.3',   '-5.0',  '-3.0',  'Normal');
INSERT INTO public.vehicle_type_parameter VALUES (25, 3, 'lc_param1',      '0.01',   '0.005', '0.005', '0.02',  'Normal');
INSERT INTO public.vehicle_type_parameter VALUES (26, 3, 'lc_param2',      '0.03',   '0.01',  '0.015', '0.05',  'Normal');
INSERT INTO public.vehicle_type_parameter VALUES (27, 3, 'lc_sensitivity', '0.002',  '1.2',   '0.0008','0.04',  'LogNormal');

-- 트럭 (id=4)
INSERT INTO public.vehicle_type_parameter VALUES (28, 4, 'veh_len',        '8.0',    '1.0',   '6.0',   '12.0',  'Normal');
INSERT INTO public.vehicle_type_parameter VALUES (29, 4, 'jamgap',         '2.0',    '0.3',   '1.5',   '2.5',   'LogNormal');
INSERT INTO public.vehicle_type_parameter VALUES (30, 4, 'vf',             '90',     '8',     '80',    '100',   'Normal');
INSERT INTO public.vehicle_type_parameter VALUES (31, 4, 'reaction_time',  '1.5',    '0.15',  '1.2',   '1.8',   'LogNormal');
INSERT INTO public.vehicle_type_parameter VALUES (32, 4, 'max_acc',        '1.2',    '0.3',   '0.8',   '1.8',   'Normal');
INSERT INTO public.vehicle_type_parameter VALUES (33, 4, 'max_dec',        '-3.5',   '0.3',   '-4.5',  '-2.5',  'Normal');
INSERT INTO public.vehicle_type_parameter VALUES (34, 4, 'lc_param1',      '0.008',  '0.003', '0.003', '0.015', 'Normal');
INSERT INTO public.vehicle_type_parameter VALUES (35, 4, 'lc_param2',      '0.025',  '0.008', '0.012', '0.04',  'Normal');
INSERT INTO public.vehicle_type_parameter VALUES (36, 4, 'lc_sensitivity', '0.0015', '1.0',   '0.0005','0.035', 'LogNormal');

-- 이륜차 (id=5)
INSERT INTO public.vehicle_type_parameter VALUES (37, 5, 'veh_len',        '2.0',    '0.2',   '1.5',   '2.5',   'Normal');
INSERT INTO public.vehicle_type_parameter VALUES (38, 5, 'jamgap',         '0.5',    '0.1',   '0.3',   '0.8',   'LogNormal');
INSERT INTO public.vehicle_type_parameter VALUES (39, 5, 'vf',             '100',    '15',    '70',    '130',   'Normal');
INSERT INTO public.vehicle_type_parameter VALUES (40, 5, 'reaction_time',  '1.0',    '0.1',   '0.8',   '1.3',   'LogNormal');
INSERT INTO public.vehicle_type_parameter VALUES (41, 5, 'max_acc',        '4.0',    '0.8',   '3.0',   '5.0',   'Normal');
INSERT INTO public.vehicle_type_parameter VALUES (42, 5, 'max_dec',        '-6.0',   '0.5',   '-7.0',  '-5.0',  'Normal');
INSERT INTO public.vehicle_type_parameter VALUES (43, 5, 'lc_param1',      '0.02',   '0.01',  '0.01',  '0.04',  'Normal');
INSERT INTO public.vehicle_type_parameter VALUES (44, 5, 'lc_param2',      '0.06',   '0.02',  '0.03',  '0.1',   'Normal');
INSERT INTO public.vehicle_type_parameter VALUES (45, 5, 'lc_sensitivity', '0.005',  '2.0',   '0.002', '0.1',   'LogNormal');

-- ============================================================
-- 7. SEQUENCE RESET (삽입된 데이터 이후부터 자동증가)
-- ============================================================

SELECT pg_catalog.setval('public.vehicle_type_id_seq', 5, true);
SELECT pg_catalog.setval('public.vehicle_type_model_id_seq', 5, true);
SELECT pg_catalog.setval('public.vehicle_type_parameter_id_seq', 45, true);
