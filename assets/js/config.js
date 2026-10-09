/* 账号系统配置 —— 填入你的 Supabase 项目信息即可启用登录与云端笔记。
 *
 * 获取方式：Supabase 控制台 → 你的项目 → Settings → API：
 *   - Project URL        填到 SUPABASE_URL
 *   - Project API keys 的 anon public key 填到 SUPABASE_ANON_KEY
 *
 * 说明：anon key 是“公开密钥”，放在前端是官方设计允许的；数据隔离依靠数据库
 * 的行级安全(RLS)策略，别人拿到这个 key 也读不到你账号下的笔记。
 *
 * 未填写（保持 YOUR_... 占位）时：站点照常运行，笔记走浏览器本地存储，
 * 顶部不显示登录入口。
 */
window.SUPABASE_URL = "https://tddmhsnmodkgkqiiuqwo.supabase.co";
window.SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRkZG1oc25tb2RrZ2txaWl1cXdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1NDQ0NDAsImV4cCI6MjEwNzEyMDQ0MH0.DWnaPSzRQb_0TYwSqEqptHSeTsEw11-LJZpqUJc2prE";
