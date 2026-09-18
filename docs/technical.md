# RouteX — chi tiết kỹ thuật

Proxy gateway tự host: một engine viết bằng Rust nhận kết nối HTTP và SOCKS5, quyết định từng kết nối nên **đi thẳng**, **qua upstream proxy** hay **bị chặn** theo bộ rule bạn đặt, kèm admin UI để chỉnh rule và xem traffic theo thời gian thực. Đổi cấu hình được áp dụng nóng, không phải restart và không làm rớt kết nối đang chạy.

![Tổng quan RouteX](screenshots/overview.png)

> Toàn bộ ảnh trong README chụp từ bản chạy local với **dữ liệu demo** (seed + số liệu mô phỏng), không phải traffic thật.

## Tính năng

- **Hai loại listener**: HTTP (`CONNECT` và absolute-form) và SOCKS5 theo RFC 1928/1929 (hiện mới hỗ trợ lệnh `CONNECT`), mỗi listener có auth username/password riêng.
- **Rule engine 7 kiểu match**: `domain`, `domain-suffix`, `domain-keyword`, `ip`, `cidr`, `port`, `process`; gom rule thành nhóm, xếp mục định tuyến theo thứ tự ưu tiên.
- **Ba hành động**: đi thẳng (direct), đẩy qua upstream (proxy) hoặc chặn (block), cộng với hành động mặc định riêng cho từng listener.
- **Upstream pool**: upstream scheme `http` hoặc `socks5`, có auth tùy chọn, theo dõi trạng thái healthy / degraded / unreachable và đo latency.
- **Hot reload**: sửa cấu hình ghi vào DB trước, bấm Apply thì engine nạp lại; listener không đổi vẫn giữ nguyên kết nối đang mở.
- **Admin UI**: React 19 + Vite + Tailwind 4, theme sáng/tối, song ngữ Việt/Anh, trang kết nối cập nhật realtime qua SSE.
- **Không phụ thuộc gì ngoài file**: state nằm trong một file SQLite duy nhất.

## Kiến trúc

```
apps/
├── server/        # Rust: axum + tokio + sqlx (SQLite)
│   └── src/
│       ├── engine/    # listener HTTP/SOCKS5, matcher, router, upstream, metrics
│       ├── routes/    # admin API dưới /api
│       ├── models/    # kiểu dữ liệu dùng chung với UI
│       └── db/        # schema + seed
└── ui/            # React 19 + Vite + Tailwind 4, gọi /api
```

## Yêu cầu

- Rust toolchain mới (crate server dùng `edition = "2024"`)
- [Bun](https://bun.sh) 1.4 cho phần UI
- Linux nếu cần match theo tiến trình (đọc `/proc/net/tcp`); các phần còn lại chạy được ở nơi khác

## Chạy thử

Terminal 1 — backend:

```bash
cd apps/server
cargo run
```

Server nghe `127.0.0.1:8090` và tự tạo file SQLite `routex.db` trong thư mục hiện tại.

Terminal 2 — admin UI:

```bash
cd apps/ui
bun install
bun run dev
```

Mở `http://localhost:5173`. Vite tự proxy `/api` sang `http://127.0.0.1:8090`.

### Biến môi trường

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `ROUTEX_API_ADDR` | `127.0.0.1:8090` | Địa chỉ admin API |
| `ROUTEX_DB` | `routex.db` | Đường dẫn file SQLite |
| `ROUTEX_SESSION_TTL_HOURS` | `24` | Hạn sống của session đăng nhập |
| `RUST_LOG` | `info` | Mức log của `tracing` |
| `VITE_API_PROXY_TARGET` | `http://127.0.0.1:8090` | Backend mà Vite dev server proxy tới |

### Lần đầu vào

Màn hình Setup yêu cầu tạo tài khoản admin duy nhất (mật khẩu 8–128 ký tự, hash bằng Argon2). Sau đó UI giữ session token và gắn vào header `Authorization: Bearer <token>`. Đổi mật khẩu sẽ xoá mọi session đang có — kể cả phiên vừa dùng để đổi — rồi cấp token mới.

### Dữ liệu mẫu — đọc trước khi dùng thật

DB trống sẽ được seed sẵn 4 nhóm rule, 17 rule template, 4 upstream và 3 listener để UI có thứ để xem ngay. Trong đó có listener bind `0.0.0.0:8080` kèm user/pass mẫu và các upstream trỏ tới host không tồn tại. **Sửa hoặc xoá hết đám này trước khi mở ra ngoài LAN.**

## Giao diện

### Định tuyến — thứ tự ưu tiên, mục đầu tiên khớp sẽ thắng

![Trang định tuyến](screenshots/routing.png)

### Thư viện rule — template gom theo nhóm, dùng lại giữa các mục định tuyến

![Thư viện rule](screenshots/templates.png)

### Listener và upstream

![Trang listener](screenshots/listeners.png)

![Trang upstream](screenshots/upstreams.png)

### Kết nối realtime

![Trang kết nối](screenshots/connections.png)

### Cài đặt và theme tối

![Trang cài đặt](screenshots/settings.png)

![Tổng quan, theme tối](screenshots/overview-dark.png)

## Rule hoạt động thế nào

Với mỗi kết nối vào, engine duyệt các mục định tuyến của listener đó theo thứ tự, **mục đầu tiên khớp sẽ thắng**; trong một mục thì duyệt lần lượt các rule template của nó. Không mục nào khớp thì rơi về hành động mặc định của listener (`direct` hoặc `block`).

| Kiểu match | Khớp khi | Ví dụ pattern |
| --- | --- | --- |
| `domain` | hostname trùng khít (không phân biệt hoa thường) | `api.openai.com` |
| `domain-suffix` | hostname kết thúc bằng pattern, cắt theo biên label | `githubusercontent.com` |
| `domain-keyword` | hostname chứa chuỗi này | `doubleclick` |
| `ip` | IP đích đúng bằng pattern | `1.1.1.1` |
| `cidr` | IP đích nằm trong dải | `192.168.0.0/16` |
| `port` | cổng đích trùng | `22` |
| `process` | tên tiến trình phía client (Linux, best-effort) | `tor` |

Một template cần thông tin mà kết nối không có — ví dụ rule `domain` khi đích là IP thuần — thì đơn giản là không khớp, không bao giờ làm lỗi kết nối.

## Trỏ client qua proxy

```bash
# Listener HTTP có bật auth
export http_proxy=http://user:pass@127.0.0.1:8080
export https_proxy=$http_proxy
curl -I https://example.com

# Listener SOCKS5 (socks5h để đẩy việc phân giải DNS sang proxy)
curl -x socks5h://user:pass@127.0.0.1:1080 https://example.com
```

Listener HTTP bật auth trả `407 Proxy Authentication Required` với Basic realm `routex`; listener SOCKS5 bật auth thì thương lượng method `0x02` theo RFC 1929.

## Luồng cấu hình

Sửa ở Thư viện rule / Định tuyến / Upstream / Listener chỉ ghi vào DB, chưa đụng tới traffic đang chạy. Khi có thay đổi chưa áp dụng, thanh pending changes hiện lên; bấm **Apply** (tương ứng `POST /api/config/apply`) để engine nạp lại cấu hình và reconcile listener:

- Listener không đổi giữ nguyên kết nối đang mở.
- Listener nào bind lỗi (ví dụ trùng cổng) thì API trả `409` kèm mảng `failedListeners` nêu đúng listener cần sửa; các listener còn lại vẫn chạy bình thường.

## Admin API

Ngoài `/api/auth/status`, `/api/auth/setup` và `/api/auth/login`, mọi route `/api/*` đều cần `Authorization: Bearer <token>`.

| Route | Dùng để |
| --- | --- |
| `POST /api/auth/setup` · `POST /api/auth/login` · `POST /api/auth/logout` · `POST /api/auth/password` | Tạo tài khoản, đăng nhập, đăng xuất, đổi mật khẩu |
| `GET/POST /api/rule-templates` · `/api/rule-groups` | Quản lý rule template và nhóm |
| `GET/POST /api/route-entries` · `PUT /api/route-entries/reorder` | Quản lý và sắp thứ tự mục định tuyến |
| `GET/POST /api/upstreams` · `POST /api/upstreams/{id}/test` | Quản lý upstream và probe thử kết nối |
| `GET/POST /api/listeners` | Quản lý listener |
| `GET/PUT /api/settings` | DNS mode, mức log, access log |
| `GET /api/metrics` · `GET /api/metrics/traffic?range=15m\|1h\|7d\|30d` | Số liệu tổng và chuỗi traffic |
| `GET /api/connections` · `GET /api/connections/stream` | Danh sách kết nối và luồng SSE realtime |
| `GET /api/host-ports` | Cổng đang bận trên máy, cho panel chọn cổng ở form listener |
| `POST /api/config/apply` | Áp dụng cấu hình đang chờ |

Ví dụ:

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:8090/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"admin","password":"<mật khẩu>"}' | jq -r .token)

curl -s http://127.0.0.1:8090/api/listeners -H "Authorization: Bearer $TOKEN"
curl -s -X POST http://127.0.0.1:8090/api/config/apply -H "Authorization: Bearer $TOKEN"
```

`GET /api/connections/stream` nhận token qua `?token=...` vì `EventSource` không gắn được header — chỉ dùng cho admin API bind loopback.

## Giới hạn hiện tại

Bản này chạy tốt trong mạng nội bộ, chưa phải bản production:

- Repo chưa có test.
- Admin API để CORS permissive, chạy HTTP thuần, chưa rate-limit endpoint login. Nên bind loopback và đừng expose ra ngoài.
- SOCKS5 mới có `CONNECT`, chưa có `UDP ASSOCIATE` / `BIND`.
- Sức khỏe upstream là thụ động: chỉ biết upstream chết khi có kết nối lỗi, chưa probe định kỳ và chưa failover.
- Chưa đóng gói: UI và server chạy rời, chưa có Docker image hay binary phát hành.

Kế hoạch tiếp theo: test + siết bảo mật, đóng gói bản chạy thật (nhúng UI vào binary, Dockerfile, systemd unit, CI theo tag), rồi health check chủ động và failover cho upstream.
