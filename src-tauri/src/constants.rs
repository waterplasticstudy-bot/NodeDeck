//! 后端集中常量配置（严禁在业务代码中散落硬编码字面量）

/// 应用主窗口标签
pub const MAIN_WINDOW_LABEL: &str = "main";
/// 系统托盘标识与悬停提示
pub const TRAY_ID: &str = "nodedeck-tray";
pub const TRAY_TOOLTIP: &str = "NodeDeck";

/// 配置文件名（位于程序同目录，已列入 .gitignore 绝不上传）
pub const CONFIG_FILE_NAME: &str = "config.json";

/// 默认主 VPS 兜底参数（零个人预设，首次启动由用户自行填写）
pub const DEFAULT_SERVER_NAME: &str = "My Primary VPS";
pub const DEFAULT_HOST: &str = "";
pub const DEFAULT_SSH_PORT: u16 = 22;
pub const DEFAULT_SSH_USER: &str = "root";
pub const DEFAULT_KEY_PATH: &str = "%USERPROFILE%\\.ssh\\id_ed25519";
pub const DEFAULT_MONTHLY_QUOTA_GB: u64 = 2000;
pub const DEFAULT_CLASH_API_PORT: u16 = 19090;
pub const DEFAULT_MIHOMO_API_URL: &str = "http://127.0.0.1:9090";

/// VLESS + Reality 链接拼接默认参数
pub const DEFAULT_SNI: &str = "www.microsoft.com";
pub const DEFAULT_VLESS_FLOW: &str = "xtls-rprx-vision";
pub const DEFAULT_VLESS_FP: &str = "chrome";

/// Windows OpenSSH 默认路径与无黑窗子进程标志
pub const WIN_OPENSSH_BIN: &str = r"C:\Windows\System32\OpenSSH\ssh.exe";
pub const WIN_OPENSSH_KEYGEN_BIN: &str = r"C:\Windows\System32\OpenSSH\ssh-keygen.exe";
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// SSH 长连接超时与保活参数
pub const SSH_HANDSHAKE_TIMEOUT_MS: u64 = 14_000;
pub const SSH_DEFAULT_CALL_TIMEOUT_MS: u64 = 15_000;
pub const SSH_MUTATE_CALL_TIMEOUT_MS: u64 = 20_000;
pub const SSH_CONNECT_TIMEOUT_SECS: &str = "8";
pub const SSH_SERVER_ALIVE_INTERVAL: &str = "15";
pub const SSH_SERVER_ALIVE_COUNT_MAX: &str = "3";
pub const SSH_STDERR_MAX_LEN: usize = 2000;

/// Alpine NAT 轻量 SSH 与可选宿主机多出口接口超时/安全参数
pub const ALPINE_SSH_TIMEOUT_MS: u64 = 12_000;
pub const ALPINE_LATENCY_TIMEOUT_MS: u64 = 25_000;
pub const ALPINE_LONG_TIMEOUT_MS: u64 = 135_000;
pub const DEFAULT_NAT_SINGBOX_CONFIG: &str = "/usr/local/etc/sing-box/config.json";
pub const ALPINE_CONFIG_PATH_PATTERN: &str = r"^/[a-zA-Z0-9._/-]{1,180}$";
pub const NAT_BACKUP_NAME_PATTERN: &str = r"^config\.json\.bak\.[0-9_]{8,24}$";
pub const DEFAULT_NAT_CLASH_API_PORT: u16 = 19091;

/// 宿主机多出口合法代号白名单
pub const RESIDENTIAL_EXIT_CODES: &[&str] = &[
    "us", "au", "hgc", "hkt", "jp", "kr", "mo", "mos", "my", "sgv", "direct",
];

/// 四大主力入站协议白名单与 SS-2022 默认套件
pub const SUPPORTED_INBOUND_PROTOS: &[&str] = &["vless", "shadowsocks", "socks", "http", "mixed"];
pub const SS2022_DEFAULT_METHOD: &str = "2022-blake3-aes-128-gcm";

/// SSH 免密向导公钥注释与远端 sshd 配置片段文件名
pub const SSH_KEY_COMMENT: &str = "nodedeck-desktop";
pub const SSHD_PUBKEY_CONF_NAME: &str = "00-nodedeck-pubkey.conf";

/// 多账号隔离 WebView2 沙箱窗口、仪表盘识别与可选单次订阅查询参数
pub const PROFILES_SUBDIR: &str = "profiles";
pub const ACCOUNT_WINDOW_PREFIX: &str = "account-";
pub const ACCOUNT_WINDOW_WIDTH: f64 = 1240.0;
pub const ACCOUNT_WINDOW_HEIGHT: f64 = 820.0;
pub const SESSION_CLOSE_SETTLE_MS: u64 = 350;
pub const DASHBOARD_SCRAPE_TIMEOUT_MS: u64 = 6_000;
pub const SUBSCRIPTION_FETCH_TIMEOUT_MS: u64 = 12_000;
pub const SUBSCRIPTION_USER_AGENT: &str = "clash-verge/v2.0.0";
pub const PROFILE_ID_PATTERN: &str = r"^[a-zA-Z0-9_-]{1,36}$";

/// NAT 原生 TCP 端口探针参数
pub const TCP_PING_TIMEOUT_MS: u64 = 4_000;

/// 本机 Mihomo / Clash API 超时与测速参数
pub const MIHOMO_TIMEOUT_MS: u64 = 3_000;
pub const MIHOMO_DELAY_TIMEOUT_MS: u64 = 7_000;
pub const MIHOMO_DELAY_TEST_URL: &str = "https://www.gstatic.com/generate_204";
pub const DEFAULT_MIHOMO_MIXED_PORT: u16 = 7890;
pub const MAX_MIHOMO_CONNECTIONS: usize = 150;

/// 外网与 AI 真实连通性并发测速参数
pub const PROBE_TIMEOUT_MS: u64 = 6_000;
pub const PROBE_USER_AGENT: &str = "Mozilla/5.0";

/// 连通性并发探针清单：(唯一ID, 显示名称, 目标地址)
pub const CONNECTIVITY_PROBES: &[(&str, &str, &str)] = &[
    ("gemini", "Gemini API", "https://generativelanguage.googleapis.com/"),
    ("claude", "Claude", "https://claude.ai/"),
    ("chatgpt", "ChatGPT", "https://chatgpt.com/"),
    ("cloudflare", "Cloudflare", "https://1.1.1.1/cdn-cgi/trace"),
    ("google", "Google 204", "https://www.gstatic.com/generate_204"),
];

/// Mihomo / Clash 策略组类型白名单与通用置顶排序
pub const MIHOMO_GROUP_TYPES: &[&str] = &["Selector", "URLTest", "Fallback", "LoadBalance"];
pub const MIHOMO_PRIORITY_GROUPS: &[&str] = &[
    "PROXY",
    "Proxy",
    "节点选择",
    "自动选择",
    "Auto",
    "Fallback",
    "GLOBAL",
];

/// 系统托盘右键菜单项 ID 与事件名
pub const TRAY_MENU_SHOW: &str = "tray_show";
pub const TRAY_MENU_MODE_RULE: &str = "tray_mode_rule";
pub const TRAY_MENU_MODE_GLOBAL: &str = "tray_mode_global";
pub const TRAY_MENU_MODE_DIRECT: &str = "tray_mode_direct";
pub const TRAY_MENU_REFRESH: &str = "tray_refresh";
pub const TRAY_MENU_QUIT: &str = "tray_quit";
pub const EVENT_TRAY_REFRESH: &str = "nodedeck://tray-refresh";

/// 成员名、多协议用户名与入站标识校验正则
pub const MEMBER_NAME_PATTERN: &str = r"^[a-zA-Z0-9_\u4e00-\u9fa5-]{1,24}$";
pub const NODE_USERNAME_PATTERN: &str = r"^[^\r\n\t:;'\\/\x22]{1,32}$";
pub const INBOUND_TAG_PATTERN: &str = r"^[a-zA-Z0-9_-]{2,32}$";
