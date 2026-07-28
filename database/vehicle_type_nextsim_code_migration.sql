-- vehicle_type.nextsim_type_code 컬럼 추가
--
-- 배경: 차량 시각화 차종(vehicle_type: CAR/TAXI/BUS/TRUCK/MOTO)을 vehicle_sim.db가
--   실제로 내보내는 NextSim 차종 코드(vehicletypes.xml 기준 NormalVeh→NV,
--   AutonomousVeh→AV, NormalBus→NB, AutonomousBus→AB, Truck→? 등)와 연결하는
--   매핑이 지금까지 VehicleController.java 안에 하드코딩되어 있었다 — "교통수단 유형"
--   편집 화면(VEHICLE_TYPE)에서 차종을 새로 추가하거나 이름을 바꿔도 반영되지 않는
--   문제가 있었음. 이 컬럼을 추가해 그 화면에서 직접 관리하도록 전환한다
--   (VehicleController.loadNextsimCodeToVehicleIdMap 참고).
--
-- 값 형식: 쉼표로 구분된 코드 목록(대소문자 무관, 조회 시 대문자로 정규화).
--   예: CAR 행 = "NV,AV", BUS 행 = "NB,AB", TRUCK 행 = "TRK,TR,TRUCK".
--   TAXI/MOTO는 이 프로젝트의 vehicletypes.xml에 대응 차종이 없어 비워둔다
--   (해당 차종은 계속 vehicle ID 해시 폴백으로만 배정됨).
--
-- ⚠️ NB/AB/TRK/TR 코드는 실측 확인 전 추정값이다(NV만 실제 vehicle_sim.db에서 확인함,
--   parameter_xml/vehicletypes.xml의 명명 규칙("단어별 첫 글자")을 그대로 적용한 값).
--   버스/트럭이 포함된 시나리오를 실행해 실제 코드를 확인한 뒤 필요하면 UPDATE로 정정할 것.

ALTER TABLE vehicle_type ADD COLUMN IF NOT EXISTS nextsim_type_code VARCHAR(255);

UPDATE vehicle_type SET nextsim_type_code = 'NV,AV'     WHERE vehicle_id = 'CAR';
UPDATE vehicle_type SET nextsim_type_code = 'NB,AB'     WHERE vehicle_id = 'BUS';
UPDATE vehicle_type SET nextsim_type_code = 'TRK,TR,TRUCK' WHERE vehicle_id = 'TRUCK';
