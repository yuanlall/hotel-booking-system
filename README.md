# 🏨 酒店预订系统 MVP

微信生态获客工具：H5预订页 + 商家后台 + 优惠券系统

## 📁 项目结构

```
hotel-booking-system/
├── index.html          # 客人端：酒店展示 + 预订页面
├── admin.html          # 商家端：订单管理 + 房态控制
├── functions/
│   └── api/
│       └── order.js    # Cloudflare Pages Function: 订单API
└── README.md
```

## 🚀 快速开始

### 1. 修改酒店信息

打开 `index.html`，找到顶部的 `HOTEL_DATA` 对象，修改：

```javascript
const HOTEL_DATA = {
    name: '你的酒店名称',
    address: '酒店地址',
    phone: '联系电话',
    // ... 其他配置
};
```

### 2. 配置收款码

在 `index.html` 中找到支付区域，替换为你的微信收款码图片：

```html
<div class="pay-qrcode" id="payQrcode">
    <img src="你的收款码URL" style="width:100%;height:100%;">
</div>
```

或者让客人截图上传：

```javascript
// 在 submitOrder() 函数中处理
```

### 3. 部署到 Cloudflare Pages

1. 将代码推送到 GitHub
2. Cloudflare → Pages → 创建项目 → 连接 GitHub
3. 构建命令留空，输出目录 `/`
4. 添加环境变量：
   - `WECOM_WEBHOOK_URL`: 企业微信群机器人地址
   - `FEISHU_APP_ID`, `FEISHU_APP_SECRET`: 飞书应用凭证（可选）
   - `FEISHU_BITABLE_APP_TOKEN`, `FEISHU_BITABLE_TABLE_ID`: 飞书表格ID（可选）
5. 部署

### 4. 自定义域名（可选）

Cloudflare Pages → 自定义域名 → 填入你的域名

## 🎯 功能说明

### 客人端 (index.html)

- ✅ Hero轮播图
- ✅ 酒店信息展示
- ✅ 价格横幅（对比OTA节省）
- ✅ 日期选择器
- ✅ 房型选择 + 价格计算
- ✅ 优惠券领取（新客券/分享券/限时券）
- ✅ 预订表单 + 微信支付
- ✅ 住客评价
- ✅ 酒店实拍相册
- ✅ 底部导航

### 商家端 (admin.html)

- ✅ 今日统计（待确认/已确认/收入）
- ✅ 房态管理（开房/关房）
- ✅ 订单列表（确认/拒绝/联系客人）
- ✅ 实时刷新

## 🔧 开发说明

### API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/order` | 提交订单 |
| GET | `/api/order?action=list` | 查询订单列表 |

### 环境变量

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `WECOM_WEBHOOK_URL` | ✅ | 企业微信群机器人 Webhook 地址 |
| `FEISHU_APP_ID` | ❌ | 飞书应用 App ID |
| `FEISHU_APP_SECRET` | ❌ | 飞书应用 App Secret |
| `FEISHU_BITABLE_APP_TOKEN` | ❌ | 飞书多维表格 App Token |
| `FEISHU_BITABLE_TABLE_ID` | ❌ | 飞书多维表格 Table ID |

### 数据库（D1，可选）

如果需要本地存储订单，创建 D1 数据库：

```bash
wrangler d1 create hotel-orders
```

然后在 `order.js` 中配置：

```javascript
// 在 Cloudflare Pages 设置中添加环境变量绑定
// 变量名: DB, 值: your-d1-database-id
```

初始化表：

```sql
CREATE TABLE orders (
    id TEXT PRIMARY KEY,
    hotel TEXT,
    room_id TEXT,
    room_name TEXT,
    room_price INTEGER,
    checkin TEXT,
    checkout TEXT,
    nights INTEGER,
    guest_name TEXT,
    guest_phone TEXT,
    note TEXT,
    original_total INTEGER,
    final_total INTEGER,
    status TEXT DEFAULT 'pending',
    created_at TEXT
);
```

## 📱 微信生态优化

### 分享卡片设置

在 `index.html` 的 `<head>` 中配置：

```html
<meta name="wechat-share-title" content="限时特惠 | 西湖边精品酒店 ¥288起">
```

### 小程序关联（后续）

可绑定同名微信小程序，实现：
- 小程序内直接打开预订页
- 微信支付
- 模板消息通知

## 🚧 后续计划

- [ ] 微信商户号接入（自动回调）
- [ ] 多酒店支持
- [ ] 会员系统
- [ ] 数据分析看板

## 📄 许可证

MIT