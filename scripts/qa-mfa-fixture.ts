import { encrypt } from "../src/server/security.ts";
import { totpCode } from "../src/core/totp.ts";
const url=new URL(process.env.DATABASE_URL!);
if(!["localhost","127.0.0.1"].includes(url.hostname)) throw new Error("Local test DB only");
url.pathname="/kerncloud_test";
process.env.DATABASE_URL=url.toString();
const {pool,transaction}=await import("../src/server/db.ts");
try {
 const id=(await pool.query("SELECT id FROM users WHERE email='admin@test.local' AND role='admin'")).rows[0]?.id;
 if(!id) throw new Error("Fixture admin missing");
 const secret="GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
 await transaction(async c=>{
  await c.query("DELETE FROM sessions WHERE user_id=$1",[id]);
  await c.query("DELETE FROM login_challenges WHERE user_id=$1",[id]);
  if(process.argv[2]==="on") await c.query("INSERT INTO account_security(user_id,totp_secret,enabled_at,last_step) VALUES($1,$2,now(),-1) ON CONFLICT(user_id) DO UPDATE SET totp_secret=EXCLUDED.totp_secret,enabled_at=now(),last_step=-1,pending_secret=NULL,pending_until=NULL,recovery_hashes='[]'",[id,encrypt(secret)]);
  else await c.query("DELETE FROM account_security WHERE user_id=$1",[id]);
 });
 console.log(JSON.stringify(process.argv[2]==="on"?{code:totpCode(secret)}:{restored:true}));
} finally{await pool.end();}
