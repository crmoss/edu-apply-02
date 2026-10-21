// 공개할 화면 파일만 복사한다. API는 Vercel의 api/에서 별도 배포한다.
const fs=require('node:fs');
fs.mkdirSync('dist',{recursive:true});
for(const file of ['index.html','style.css','logic.js','app.js','signup.js','client-api.js'])fs.copyFileSync(file,`dist/${file}`);
