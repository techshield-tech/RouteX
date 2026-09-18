# RouteX

**Bạn quyết định mỗi kết nối mạng đi đường nào.**

RouteX là proxy gateway tự host: bạn cài trên máy của mình, trỏ máy tính hoặc thiết bị qua nó, rồi đặt luật cho từng loại traffic — cái này đi thẳng, cái kia vòng qua proxy khác, cái còn lại chặn thẳng tay. Mọi thứ chỉnh bằng giao diện web, đổi xong bấm một nút là có hiệu lực ngay, không cần khởi động lại, không rớt kết nối đang chạy.

![Tổng quan RouteX](docs/screenshots/overview.png)

> Ảnh trong README chụp từ bản chạy thử với dữ liệu demo, không phải traffic thật.

---

## Vấn đề RouteX giải quyết

Bạn đang dùng một đống công cụ rời rạc: một VPN cho công việc, một proxy cho vài trang, file hosts để chặn quảng cáo, và không có chỗ nào xem được thực tế máy mình đang kết nối đi đâu.

RouteX gom hết về một chỗ:

- **Một cổng vào duy nhất** cho mọi ứng dụng — trình duyệt, terminal, máy ảo, thiết bị trong LAN.
- **Một bộ luật duy nhất** quyết định mọi kết nối.
- **Một màn hình duy nhất** để nhìn thấy traffic đang chạy theo thời gian thực.

Và quan trọng: nó chạy trên máy bạn. Không tài khoản đám mây, không gửi dữ liệu đi đâu, toàn bộ lịch sử và cấu hình nằm trong một file duy nhất trên ổ cứng của bạn.

## Hợp với ai

- **Dân MMO chạy nhiều proxy tính theo dung lượng** — chỉ đẩy phần traffic thật sự cần IP proxy qua proxy, phần còn lại đi thẳng, quota không bị đốt oan.
- **Dev & kỹ sư hệ thống** — tách traffic công việc qua proxy công ty, còn lại đi thẳng cho nhanh.
- **Người tự quản mạng nhà** — chặn quảng cáo, tracker, tên miền rác cho cả nhà bằng một luật duy nhất.
- **Ai cần một đường đi riêng cho vài dịch vụ** — chỉ một nhóm tên miền cần đi vòng, phần còn lại giữ nguyên tốc độ trực tiếp.
- **Ai thích tự chủ** — không muốn phụ thuộc dịch vụ bên thứ ba để định tuyến traffic của chính mình.

---

## Khi bạn xài proxy tính theo GB

Proxy dân dụng, proxy xoay, proxy theo phiên — phần lớn tính tiền theo dung lượng hoặc kèm quota. Cái đắt không phải là request cần IP proxy, mà là mọi thứ đi ké theo nó: ảnh, video, font, CDN, bản cập nhật, telemetry. Chúng chiếm phần lớn băng thông nhưng chẳng cần IP nào đặc biệt.

RouteX cắt đúng chỗ đó:

- **Chỉ những gì cần mới đi qua proxy.** Đặt luật theo tên miền: nhóm tên miền của dịch vụ bạn đang làm thì đi proxy, CDN và mấy thứ tải nặng thì đi thẳng, tracker thì chặn luôn. Cùng một khối lượng công việc, dung lượng trừ vào proxy giảm hẳn.
- **Mỗi cổng một proxy riêng.** Mở nhiều cổng, mỗi cổng gắn bộ luật và proxy của nó. Profile này ra cổng 8081, profile kia ra cổng 8082 — không còn cảnh nhầm IP giữa các phiên.
- **Biết proxy nào đang chết.** Bảng trạng thái hiện rõ khoẻ / chập chờn / không tới được kèm độ trễ, bấm một nút để thử lại. Không phải ngồi đoán vì sao phiên bị lỗi.
- **Nhìn được mình đang tiêu bao nhiêu.** Biểu đồ tách riêng phần đi qua proxy và phần đi thẳng, xem theo 15 phút, 1 giờ, 7 ngày hoặc 30 ngày. Danh sách kết nối ghi rõ từng kết nối đi đâu, luật nào quyết định, chạy hết bao nhiêu dữ liệu.
- **Đổi proxy giữa chừng không phá phiên đang chạy.** Proxy hết hạn thì sửa trong giao diện rồi bấm Apply; các cổng không đụng tới vẫn giữ nguyên kết nối đang mở.

> Hiện RouteX chưa tự chuyển sang proxy dự phòng khi một proxy chết — bạn thấy nó đỏ trên bảng và tự đổi. Tự động failover đang trong kế hoạch.

---

## Bên trong có gì

### Định tuyến theo thứ tự ưu tiên

Bạn xếp các mục định tuyến từ trên xuống. Kết nối nào tới sẽ được soi lần lượt, **mục đầu tiên khớp sẽ thắng** — giống cách bạn đọc một danh sách việc cần làm. Không mục nào khớp thì rơi về hành động mặc định bạn đặt sẵn.

Ba lựa chọn cho mỗi mục: **đi thẳng**, **đẩy qua proxy khác**, hoặc **chặn**.

![Trang định tuyến](docs/screenshots/routing.png)

### Thư viện luật dùng lại được

Viết một lần, dùng nhiều nơi. Luật khớp theo tên miền, đuôi tên miền, từ khoá trong tên miền, địa chỉ IP, dải mạng, cổng, hoặc theo tên ứng dụng đang mở kết nối. Gom chúng thành nhóm — "Quảng cáo", "Mạng nội bộ", "Dịch vụ AI" — rồi gắn nhóm vào mục định tuyến.

![Thư viện rule](docs/screenshots/templates.png)

### Nhiều cửa vào, mỗi cửa một chính sách

Mở bao nhiêu cổng tuỳ bạn, mỗi cổng có mật khẩu riêng và bộ luật riêng. Một cổng cho máy bạn, một cổng cho thiết bị trong nhà, một cổng cho máy ảo — chính sách khác nhau hoàn toàn.

![Trang listener](docs/screenshots/listeners.png)

### Proxy trung chuyển có theo dõi sức khoẻ

Khai báo các proxy mà RouteX sẽ đẩy traffic qua. Giao diện hiện rõ cái nào đang khoẻ, cái nào chập chờn, cái nào chết, kèm độ trễ đo được. Bấm một nút để thử kết nối bất cứ lúc nào.

![Trang upstream](docs/screenshots/upstreams.png)

### Nhìn thấy traffic ngay khi nó xảy ra

Danh sách kết nối cập nhật trực tiếp: ai đang gọi đi đâu, luật nào đã quyết định, đi thẳng hay vòng hay bị chặn, bao nhiêu dữ liệu đã chạy qua.

![Trang kết nối](docs/screenshots/connections.png)

### Đổi cấu hình không làm gián đoạn

Mọi chỉnh sửa được giữ ở trạng thái chờ và hiện trên thanh thông báo. Bạn sửa thoải mái, xem lại, rồi bấm **Apply** một lần. Những cổng không thay đổi vẫn giữ nguyên kết nối đang mở — không ai bị rớt giữa chừng.

### Giao diện dùng được thật

Sáng và tối, tiếng Việt và tiếng Anh, chạy tốt trên màn hình lớn lẫn máy tính bảng.

![Trang cài đặt](docs/screenshots/settings.png)

![Tổng quan, theme tối](docs/screenshots/overview-dark.png)

---

## Dùng thử trong 2 phút

Cần [Rust](https://rustup.rs) và [Bun](https://bun.sh) trên máy.

```bash
# Cửa sổ 1 — engine
cd apps/server && cargo run

# Cửa sổ 2 — giao diện quản trị
cd apps/ui && bun install && bun run dev
```

Mở `http://localhost:5173`, tạo tài khoản quản trị ở màn hình đầu tiên, và bạn đã có một gateway đang chạy.

Sau đó trỏ ứng dụng của bạn qua nó:

```bash
export http_proxy=http://user:pass@127.0.0.1:8080
export https_proxy=$http_proxy
```

> **Lưu ý:** lần chạy đầu, RouteX tạo sẵn dữ liệu mẫu để bạn có thứ xem ngay — gồm vài cổng, luật và proxy giả. Hãy sửa hoặc xoá chúng trước khi dùng thật.

---

## Trạng thái hiện tại

RouteX đã dùng được hằng ngày trong mạng nội bộ. Bản này **chưa phải bản production**: nên chạy trên máy cá nhân hoặc trong LAN tin cậy, đừng mở giao diện quản trị ra Internet.

Đang làm tiếp:

- Đóng gói bản cài đặt sẵn (một file chạy duy nhất, Docker).
- Tự động kiểm tra sức khoẻ proxy và chuyển sang proxy dự phòng khi hỏng.
- Siết bảo mật cho giao diện quản trị.

---

## Chi tiết kỹ thuật

Engine viết bằng Rust (axum + tokio), hỗ trợ HTTP proxy và SOCKS5, lưu toàn bộ state trong một file SQLite. Giao diện là React 19 + Vite + Tailwind. Tài liệu API, biến môi trường và cách hoạt động chi tiết của bộ luật xem trong [`docs/technical.md`](docs/technical.md).

---

## License

RouteX được phát hành theo **Business Source License 1.1** — bạn được dùng, sửa đổi và tự host cho mục đích phi thương mại. Dùng cho mục đích thương mại thì không được phép.

> Đến ngày **2030-09-18**, giấy phép tự động chuyển sang Apache License 2.0.

Chi tiết đầy đủ nằm trong file [`LICENSE`](LICENSE).
