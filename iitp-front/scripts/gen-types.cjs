#!/usr/bin/env node

const { execSync } = require("child_process");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");

// === 실행 모드 결정 (기본: local) ===
const mode = process.argv[2] || "local";

// === output 경로 인자 (기본값: src/type/openapi.gen.d.ts) ===
const outputArg = process.argv[3];
const OUTPUT = outputArg || "src/type/openapi.gen.d.ts";

// === dotenv 파일 로드 ===
const envFile = mode === "develop" ? ".env.develop" : ".env";
const envPath = path.resolve(process.cwd(), envFile);

if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    console.log(`환경 변수 로드: ${envFile}`);
} else {
    console.warn(`${envFile} 파일이 없어 기본값만 사용합니다.`);
}

// === URL 설정 ===
const url = (process.env.VITE_API_URL || "http://localhost:8080") + "/api-docs";

// === 옵션 고정 ===
const OPTIONS = "--export-type --root-types --root-types-no-schema-prefix";

// === 실행 명령 ===
const cmd = `npx openapi-typescript ${url} -o ${OUTPUT} ${OPTIONS}`;

console.log(`OpenAPI 타입 생성 시작 (${mode})`);
console.log(`URL: ${url}`);
console.log(`OUT: ${OUTPUT}`);

try {
    execSync(cmd, { stdio: "inherit" });
    console.log("타입 생성 완료");
} catch (err) {
    console.error("타입 생성 실패:", err.message);
    process.exit(1);
}


// node scripts/gen-types.cjs local
// node scripts/gen-types.cjs develop

// output 경로도 직접 지정
// node scripts/gen-types.cjs local src/type/local-api.gen.d.ts
// node scripts/gen-types.cjs develop src/type/dev-api.gen.d.ts