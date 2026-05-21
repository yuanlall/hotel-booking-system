// ========== Cloudflare Pages Function: AI 官网生成器 ==========
// POST /api/generate — 接收酒店配置，生成官网HTML，部署到 CF Pages

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

// 生成完整酒店官网 HTML
function generateHotelHTML(config) {
  const { hotelName, hotelPhone, hotelAddress, hotelDesc, hotelTags, hotelRating,
          reviewCount, checkinTime, checkoutTime, parking, bookingUrl, rooms, photos } = config;
  const tags = hotelTags ? hotelTags.split(/[,，]/).filter(Boolean).map(t => t.trim()) : [];
  const tagsHTML = tags.map(t => `<span class="tag">${t}</span>`).join('');

  // 房型卡片
  const roomsHTML = rooms.map((r, i) => {
    const features = r.features ? r.features.split(/[,，]/).filter(Boolean) : [];
    const featHTML = features.map(f => `<span class="feature">✓ ${f.trim()}</span>`).join('');
    const photoSrc = photos[i + 1] || `https://picsum.photos/seed/${encodeURIComponent(hotelName)}-${i}/600/400`;
    return `
      <div class="room-card">
        <div class="room-img" style="background-image: url('${photoSrc}')"></div>
        <div class="room-info">
          <h3 class="room-name">${r.name}</h3>
          <div class="room-meta">${r.area ? `<span>${r.area}</span>` : ''}${r.bed ? `<span>· ${r.bed}</span>` : ''}</div>
          <div class="room-features">${featHTML}</div>
          <div class="room-bottom">
            <div class="room-price"><span class="price">¥${r.price}</span><span class="per">/晚</span></div>
            <a href="${bookingUrl}" class="btn-book">立即预订</a>
          </div>
        </div>
      </div>`;
  }).join('');

  // Hero背景
  const heroBg = photos[0] || `https://picsum.photos/seed/${encodeURIComponent(hotelName)}-hero/1920/1080`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${hotelName} — 官方直销0佣金预订</title>
<meta name="description" content="${hotelDesc} | ${hotelName}，入住时间${checkinTime}，退房时间${checkoutTime}，${parking}停车">
<meta property="og:title" content="${hotelName} — 官方直销预订">
<meta property="og:description" content="${hotelDesc}">
<meta property="og:image" content="${heroBg}">
<meta property="og:type" content="hotel">
<meta itemprop="name" content="${hotelName}">
<meta itemprop="description" content="${hotelDesc}">
<meta itemprop="image" content="${heroBg}">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--primary:#b8860b;--primary-dark:#8b6914;--text:#1a1a2e;--text-light:#666;--bg:#faf9f7;--white:#fff;--shadow:0 4px 24px rgba(0,0,0,0.08);--radius:16px}
body{font-family:-apple-system,'PingFang SC','Helvetica Neue',sans-serif;background:var(--bg);color:var(--text);line-height:1.6;-webkit-font-smoothing:antialiased}
nav{position:fixed;top:0;left:0;right:0;z-index:100;background:rgba(255,255,255,0.92);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid rgba(0,0,0,0.06);padding:0 24px;height:60px;display:flex;align-items:center;justify-content:space-between;transition:box-shadow .3s}
nav.scrolled{box-shadow:0 2px 20px rgba(0,0,0,0.08)}
.nav-brand{font-size:18px;font-weight:700;color:var(--text);text-decoration:none}
.nav-links{display:flex;gap:24px;align-items:center}
.nav-links a{color:var(--text-light);text-decoration:none;font-size:14px;font-weight:500;transition:color .2s}
.nav-links a:hover{color:var(--primary)}
.nav-cta{background:var(--primary)!important;color:var(--white)!important;padding:8px 20px;border-radius:8px;font-weight:600!important}
.nav-cta:hover{background:var(--primary-dark)!important}
.menu-btn{display:none;background:none;border:none;font-size:24px;cursor:pointer}
.hero{position:relative;height:100vh;min-height:600px;max-height:900px;background:url('${heroBg}') center/cover no-repeat;display:flex;align-items:center;justify-content:center;text-align:center;color:var(--white)}
.hero::before{content:'';position:absolute;inset:0;background:linear-gradient(to bottom,rgba(0,0,0,0.3) 0%,rgba(0,0,0,0.5) 100%)}
.hero-content{position:relative;z-index:1;max-width:600px;padding:0 24px}
.hero h1{font-size:clamp(28px,6vw,48px);font-weight:800;margin-bottom:16px;text-shadow:0 2px 12px rgba(0,0,0,0.3);letter-spacing:2px}
.hero p{font-size:clamp(14px,2.5vw,18px);opacity:0.9;margin-bottom:24px;text-shadow:0 1px 6px rgba(0,0,0,0.2)}
.hero-tags{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:32px}
.hero-tags .tag{background:rgba(255,255,255,0.2);backdrop-filter:blur(8px);padding:6px 16px;border-radius:20px;font-size:13px;font-weight:500}
.hero .btn-hero{display:inline-block;background:var(--primary);color:var(--white);padding:14px 40px;border-radius:12px;font-size:16px;font-weight:700;text-decoration:none;box-shadow:0 4px 20px rgba(184,134,11,0.4);transition:all .3s}
.hero .btn-hero:hover{background:var(--primary-dark);transform:translateY(-2px);box-shadow:0 6px 28px rgba(184,134,11,0.5)}
.section{padding:80px 24px;max-width:1100px;margin:0 auto}
.section-header{text-align:center;margin-bottom:48px}
.section-header h2{font-size:clamp(22px,4vw,32px);font-weight:700;margin-bottom:8px;color:var(--text)}
.section-header p{color:var(--text-light);font-size:15px}
.section-header .divider{width:48px;height:3px;background:var(--primary);margin:12px auto 0;border-radius:2px}
.highlights{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:24px}
.highlight-item{text-align:center;padding:32px 16px;background:var(--white);border-radius:var(--radius);box-shadow:var(--shadow);transition:transform .3s}
.highlight-item:hover{transform:translateY(-4px)}
.highlight-icon{font-size:36px;margin-bottom:12px}
.highlight-item h3{font-size:15px;font-weight:600;margin-bottom:4px}
.highlight-item p{font-size:13px;color:var(--text-light)}
.rooms-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:24px}
.room-card{background:var(--white);border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow);transition:transform .3s,box-shadow .3s}
.room-card:hover{transform:translateY(-6px);box-shadow:0 12px 40px rgba(0,0,0,0.12)}
.room-img{height:220px;background-size:cover;background-position:center;position:relative}
.room-info{padding:24px}
.room-name{font-size:18px;font-weight:700;margin-bottom:4px}
.room-meta{font-size:13px;color:var(--text-light);margin-bottom:12px}
.room-features{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}
.feature{font-size:12px;color:#059669;background:#ecfdf5;padding:4px 10px;border-radius:4px}
.room-bottom{display:flex;justify-content:space-between;align-items:center;padding-top:16px;border-top:1px solid #f0f0f0}
.price{font-size:24px;font-weight:800;color:#e11d48}
.per{font-size:13px;color:var(--text-light);font-weight:400}
.btn-book{display:inline-block;background:var(--primary);color:var(--white);padding:10px 24px;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;transition:all .2s}
.btn-book:hover{background:var(--primary-dark)}
.gallery-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.gallery-grid .wide{grid-column:span 2}
.gallery-item{border-radius:12px;overflow:hidden;aspect-ratio:4/3}
.gallery-item.wide{aspect-ratio:2/1}
.gallery-item img{width:100%;height:100%;object-fit:cover;transition:transform .5s}
.gallery-item:hover img{transform:scale(1.05)}
.contact-grid{display:grid;grid-template-columns:1fr 1fr;gap:32px}
.contact-info{display:flex;flex-direction:column;gap:20px}
.contact-item{display:flex;gap:12px;align-items:flex-start}
.contact-icon{font-size:24px;flex-shrink:0}
.contact-item h3{font-size:14px;font-weight:600;margin-bottom:2px}
.contact-item p{font-size:14px;color:var(--text-light)}
.contact-map{border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow);aspect-ratio:4/3;background:#e5e7eb}
.contact-map iframe{width:100%;height:100%;border:none}
footer{background:#1a1a2e;color:rgba(255,255,255,0.7);padding:48px 24px 24px}
.footer-content{max-width:1100px;margin:0 auto;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:16px}
.footer-brand{font-size:16px;font-weight:700;color:var(--white)}
.footer-links{display:flex;gap:20px}
.footer-links a{color:rgba(255,255,255,0.7);text-decoration:none;font-size:13px}
.footer-links a:hover{color:var(--white)}
.footer-copy{max-width:1100px;margin:24px auto 0;padding-top:24px;border-top:1px solid rgba(255,255,255,0.1);text-align:center;font-size:12px}
@media(max-width:768px){
  .nav-links{display:none;position:absolute;top:60px;left:0;right:0;background:var(--white);flex-direction:column;padding:16px 24px;box-shadow:0 8px 24px rgba(0,0,0,0.1);gap:0}
  .nav-links.open{display:flex}
  .nav-links a{padding:12px 0;border-bottom:1px solid #f0f0f0;width:100%}
  .menu-btn{display:block}
  .rooms-grid{grid-template-columns:1fr}
  .gallery-grid{grid-template-columns:1fr}
  .gallery-grid .wide{grid-column:span 1}
  .contact-grid{grid-template-columns:1fr}
  .highlights{grid-template-columns:1fr 1fr}
  .hero{min-height:500px}
  .section{padding:48px 16px}
}
.fade-up{opacity:0;transform:translateY(30px);transition:opacity .6s,transform .6s}
.fade-up.visible{opacity:1;transform:translateY(0)}
</style>
</head>
<body>
<nav id="navbar">
  <a href="#" class="nav-brand">${hotelName}</a>
  <div class="nav-links" id="navLinks">
    <a href="#rooms">客房预订</a>
    <a href="#gallery">酒店环境</a>
    <a href="#contact">联系我们</a>
    <a href="${bookingUrl}" class="nav-cta">立即预订</a>
  </div>
  <button class="menu-btn" id="menuBtn" onclick="document.getElementById('navLinks').classList.toggle('open')">☰</button>
</nav>
<section class="hero">
  <div class="hero-content">
    <h1>${hotelName}</h1>
    <p>${hotelDesc}</p>
    ${tagsHTML ? '<div class="hero-tags">' + tagsHTML + '</div>' : ''}
    <a href="${bookingUrl}" class="btn-hero">立即预订 →</a>
  </div>
</section>
<section class="section fade-up" id="highlights">
  <div class="section-header">
    <h2>为什么选择我们</h2>
    <p>用心服务，让每一次入住都成为美好回忆</p>
    <div class="divider"></div>
  </div>
  <div class="highlights">
    <div class="highlight-item"><div class="highlight-icon">💰</div><h3>官方直销</h3><p>0佣金，比OTA平台更优惠</p></div>
    <div class="highlight-item"><div class="highlight-icon">⭐</div><h3>住客好评 ${hotelRating}分</h3><p>${reviewCount}+位住客的真实评价</p></div>
    <div class="highlight-item"><div class="highlight-icon">🕐</div><h3>灵活入住</h3><p>入住 ${checkinTime} · 退房 ${checkoutTime}</p></div>
    <div class="highlight-item"><div class="highlight-icon">🅿️</div><h3>${parking}停车</h3><p>自驾出行的理想选择</p></div>
  </div>
</section>
<section class="section fade-up" id="rooms">
  <div class="section-header">
    <h2>精选房型</h2>
    <p>多种房型满足不同需求，官方预订更优惠</p>
    <div class="divider"></div>
  </div>
  <div class="rooms-grid">
    ${roomsHTML}
  </div>
  <div style="text-align:center;margin-top:32px">
    <a href="${bookingUrl}" class="btn-hero" style="display:inline-block;font-size:15px;padding:12px 32px">查看全部房型与房态 →</a>
  </div>
</section>
<section class="section fade-up" id="gallery" style="background:var(--white);max-width:100%;padding-left:0;padding-right:0">
  <div style="max-width:1100px;margin:0 auto;padding:0 24px">
    <div class="section-header">
      <h2>酒店环境</h2>
      <p>舒适优雅的入住空间</p>
      <div class="divider"></div>
    </div>
    <div class="gallery-grid">
      <div class="gallery-item wide"><img src="${photos[0] || 'https://picsum.photos/seed/g1/800/400'}" alt="${hotelName}外景" loading="lazy"></div>
      <div class="gallery-item"><img src="${photos[1] || 'https://picsum.photos/seed/g2/400/300'}" alt="客房" loading="lazy"></div>
      <div class="gallery-item"><img src="${photos[2] || 'https://picsum.photos/seed/g3/400/300'}" alt="餐厅" loading="lazy"></div>
      <div class="gallery-item"><img src="${photos[3] || 'https://picsum.photos/seed/g4/400/300'}" alt="设施" loading="lazy"></div>
      <div class="gallery-item"><img src="${photos[4] || 'https://picsum.photos/seed/g5/400/300'}" alt="特色" loading="lazy"></div>
    </div>
  </div>
</section>
<section class="section fade-up" id="contact">
  <div class="section-header">
    <h2>联系我们</h2>
    <p>期待为您服务</p>
    <div class="divider"></div>
  </div>
  <div class="contact-grid">
    <div class="contact-info">
      <div class="contact-item"><span class="contact-icon">📞</span><div><h3>预订电话</h3><p><a href="tel:${hotelPhone}" style="color:var(--primary);text-decoration:none;font-weight:600">${hotelPhone}</a></p></div></div>
      <div class="contact-item"><span class="contact-icon">📍</span><div><h3>酒店地址</h3><p>${hotelAddress}</p></div></div>
      <div class="contact-item"><span class="contact-icon">🕐</span><div><h3>入住/退房</h3><p>入住 ${checkinTime} · 退房 ${checkoutTime}</p></div></div>
      <div class="contact-item"><span class="contact-icon">🅿️</span><div><h3>停车信息</h3><p>${parking}停车</p></div></div>
    </div>
    <div class="contact-map">
      <iframe src="https://uri.amap.com/marker?position=115.0,25.8&name=${encodeURIComponent(hotelName)}&callnative=0" allowfullscreen loading="lazy"></iframe>
    </div>
  </div>
</section>
<footer>
  <div class="footer-content">
    <div class="footer-brand">${hotelName}</div>
    <div class="footer-links">
      <a href="${bookingUrl}">在线预订</a>
      <a href="#rooms">房型介绍</a>
      <a href="#contact">联系我们</a>
    </div>
  </div>
  <div class="footer-copy">
    <p>© ${new Date().getFullYear()} ${hotelName} 版权所有 · 官方直销更优惠</p>
  </div>
</footer>
<script>
const navbar=document.getElementById('navbar');
window.addEventListener('scroll',()=>{navbar.classList.toggle('scrolled',window.scrollY>50)});
const observer=new IntersectionObserver((entries)=>{entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');observer.unobserve(e.target)}})},{threshold:0.1});
document.querySelectorAll('.fade-up').forEach(el=>observer.observe(el));
document.querySelectorAll('a[href^="#"]').forEach(a=>{a.addEventListener('click',e=>{e.preventDefault();const t=document.querySelector(a.getAttribute('href'));if(t)t.scrollIntoView({behavior:'smooth',block:'start'});document.getElementById('navLinks').classList.remove('open')})});
</script>
</body>
</html>`;
}

// 部署到 Cloudflare Pages (Direct Upload API)
async function deployToPages(accountId, token, projectName, htmlContent) {
  // 1. Create project (ignore if already exists)
  try {
    await fetch(
      'https://api.cloudflare.com/client/v4/accounts/' + accountId + '/pages/projects',
      {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: projectName, production_branch: 'main' })
      }
    );
  } catch(e) { /* ignore */ }

  // 2. Upload via Direct Upload — JSON body with base64-encoded content
  const b64Content = Buffer.from(htmlContent, 'utf-8').toString('base64');
  const uploadResp = await fetch(
    'https://api.cloudflare.com/client/v4/accounts/' + accountId + '/pages/projects/' + projectName + '/deployments',
    {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        manifest: [{
          filePath: '/index.html',
          content: b64Content,
          type: 'data'  // 'data' means base64-encoded
        }]
      })
    }
  );

  if (!uploadResp.ok) {
    const errText = await uploadResp.text();
    return { success: false, message: 'HTTP ' + uploadResp.status + ': ' + errText.slice(0, 300) };
  }
  const uploadResult = await uploadResp.json();

  if (uploadResult.success) {
    const subdomain = uploadResult.result && uploadResult.result.subdomain;
    return {
      success: true,
      url: subdomain ? 'https://' + subdomain : 'https://' + projectName + '.pages.dev'
    };
  } else {
    return { success: false, message: (uploadResult.errors || []).map(e => e.message).join(', ') || 'Upload failed' };
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const { hotelName, hotelPhone, hotelAddress, hotelDesc, hotelTags, hotelRating,
            reviewCount, checkinTime, checkoutTime, parking, bookingUrl, rooms, photos } = body;

    if (!hotelName) return jsonResponse({ success: false, message: '缺少酒店名称' });
    if (!rooms || !rooms.length) return jsonResponse({ success: false, message: '至少需要一个房型' });

    // Generate HTML
    const html = generateHotelHTML({
      hotelName: hotelName || '精品酒店',
      hotelPhone: hotelPhone || '',
      hotelAddress: hotelAddress || '',
      hotelDesc: hotelDesc || '',
      hotelTags: hotelTags || '',
      hotelRating: hotelRating || 4.5,
      reviewCount: reviewCount || 0,
      checkinTime: checkinTime || '14:00',
      checkoutTime: checkoutTime || '12:00',
      parking: parking || '免费',
      bookingUrl: bookingUrl || '#',
      rooms,
      photos: photos || []
    });

    // Generate project name (slug)
    const slug = hotelName
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30);
    const projectName = 'hotel-' + slug.toLowerCase() + '-' + Date.now().toString(36);

    // Deploy
    const CF_TOKEN = context.env.CF_API_TOKEN;
    const CF_ACCOUNT = context.env.CF_ACCOUNT_ID;
    if (!CF_TOKEN || !CF_ACCOUNT) {
      return jsonResponse({ success: false, message: '缺少部署配置，请设置 CF_API_TOKEN 和 CF_ACCOUNT_ID 环境变量' });
    }

    const deployResult = await deployToPages(CF_ACCOUNT, CF_TOKEN, projectName, html);

    if (deployResult.success) {
      return jsonResponse({ success: true, url: deployResult.url, projectName });
    } else {
      return jsonResponse({ success: false, message: '部署失败: ' + deployResult.message });
    }

  } catch (e) {
    return jsonResponse({ success: false, message: '生成失败: ' + (e.message || '未知错误') }, 500);
  }
}
