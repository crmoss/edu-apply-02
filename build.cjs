// 공개할 화면 파일만 복사한다. API는 Vercel의 api/에서 별도 배포한다.
const fs=require('node:fs');
fs.mkdirSync('dist',{recursive:true});
// 파일명 변경 전 빌드 산출물이 배포 폴더에 남지 않게 한다.
fs.rmSync('dist/signup.js',{force:true});
for(const file of ['index.html','style.css','logic.js','app.js','auth.js','client-api.js','google-calendar-client.js'])fs.copyFileSync(file,`dist/${file}`);
