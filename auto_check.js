/**
 * CPA Sentinel AI 资产巡检与健康托管面板
 * 动态注入悬浮按钮与监控界面，支持手动和自动管理
 */
(function() {
  if (window.__CPA_SENTINEL_BOOTSTRAPPED__) return;
  window.__CPA_SENTINEL_BOOTSTRAPPED__ = true;

  const CHECK_INTERVAL = 60000; // 后台自动巡检的时间间隔 (毫秒)
  const AUTO_SCAN_ENABLED_KEY = 'cpamc_auto_scan_enabled';
  const AUTO_SCAN_INTERVAL_KEY = 'cpamc_auto_scan_interval_seconds';
  const AUTO_SCAN_CONCURRENCY_KEY = 'cpamc_auto_scan_concurrency';
  const AUTO_PROVIDER_SCAN_ENABLED_KEY = 'cpamc_auto_provider_scan_enabled';
  const AUTO_PROVIDER_SCAN_INTERVAL_KEY = 'cpamc_auto_provider_scan_interval_seconds';
  const AUTO_PROVIDER_SCAN_CONCURRENCY_KEY = 'cpamc_auto_provider_scan_concurrency';
  const AUTO_DISABLE_INVALID_PROVIDER_KEY = 'cpamc_auto_disable_invalid_provider';
  const AUTO_ENABLE_RECOVERED_PROVIDER_KEY = 'cpamc_auto_enable_recovered_provider';
  const PROVIDER_HEALTH_STATS_KEY = 'cpamc_provider_health_stats';
  const AUTO_EVICT_INVALID_AUTH_KEY = 'cpamc_auto_evict_invalid_auth';
  const DEFAULT_AUTO_SCAN_INTERVAL_SECONDS = CHECK_INTERVAL / 1000;
  const DEFAULT_AUTO_SCAN_CONCURRENCY = 3;
  const MIN_AUTO_SCAN_INTERVAL_SECONDS = 10;
  const MAX_AUTO_SCAN_INTERVAL_SECONDS = 3600;
  const MIN_AUTO_SCAN_CONCURRENCY = 1;
  const MAX_AUTO_SCAN_CONCURRENCY = 10;
  const DEFAULT_PROVIDER_DISABLE_FAILURE_THRESHOLD = 5;
  const HIGH_SUCCESS_PROVIDER_DISABLE_FAILURE_THRESHOLD = 10;
  const HIGH_SUCCESS_PROVIDER_RATE_THRESHOLD = 0.95;
  const HIGH_SUCCESS_PROVIDER_MIN_REQUESTS = 20;
  const PROVIDER_RECOVERY_SUCCESS_THRESHOLD = 2;
  const AUTH_VERIFY_TIMEOUT_MS = 15000;
  const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
  const CODEX_USAGE_UA = 'codex_cli_rs/0.76.0 (Debian 13.0.0; x86_64) WindowsTerminal';

  function captureAuthTokenFromHeader(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text || !text.toLowerCase().startsWith('bearer ')) return;
    const token = text.slice(7).trim();
    if (!token) return;
    localStorage.setItem('cpamc_custom_token', token);
    if (typeof updateToolVisibility === 'function') updateToolVisibility();
  }

  function isSameOriginRequestUrl(value) {
    if (!value) return true;
    const raw = typeof value === 'string'
      ? value
      : (typeof value?.url === 'string' ? value.url : '');
    if (!raw) return true;
    try {
      return new URL(raw, window.location.origin).origin === window.location.origin;
    } catch (_) {
      return true;
    }
  }

  // ==========================================
  // 【核心黑科技】：全局拦截器
  // 由于 React 可能会把 Token 藏在内存在不暴露给全局，外挂脚本无法直接读取。
  // 通过劫持全局的 fetch 和 XMLHttpRequest，只要原版页面发送过一次带有 Authorization 的请求，
  // 我们就能瞬间“截获”并保存下来，实现无缝单点登录体验，彻底干掉手动输入弹窗！
  // ==========================================
  
  // 1. 劫持 fetch
  if (!window.__CPA_SENTINEL_FETCH_WRAPPED__ && typeof window.fetch === 'function') {
    const originalFetch = window.fetch.bind(window);
    window.__CPA_SENTINEL_FETCH_WRAPPED__ = true;
    window.fetch = async function(...args) {
      if (isSameOriginRequestUrl(args[0]) && args[1] && args[1].headers) {
        let authHeader = null;
        if (args[1].headers instanceof Headers) {
          authHeader = args[1].headers.get('Authorization');
        } else if (typeof args[1].headers === 'object') {
          const authKey = Object.keys(args[1].headers).find(k => String(k).toLowerCase() === 'authorization');
          if (authKey) authHeader = args[1].headers[authKey];
        }
        captureAuthTokenFromHeader(authHeader);
      }
      return originalFetch(...args);
    };
  }

  // 2. 劫持 XMLHttpRequest (如 Axios 默认使用的底层)
  if (
    typeof XMLHttpRequest !== 'undefined' &&
    XMLHttpRequest.prototype &&
    !XMLHttpRequest.prototype.__CPA_SENTINEL_XHR_WRAPPED__
  ) {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.__CPA_SENTINEL_XHR_WRAPPED__ = true;
    XMLHttpRequest.prototype.open = function() {
        this.__cpamcRequestUrl = arguments[1];
        return originalOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
        if (
          isSameOriginRequestUrl(this.__cpamcRequestUrl) &&
          String(header || '').toLowerCase() === 'authorization'
        ) {
            captureAuthTokenFromHeader(value);
        }
        return originalSetRequestHeader.apply(this, arguments);
    };
  }
  // ==========================================


  // 注入 CSS 样式
  const style = document.createElement('style');
  style.innerHTML = `
    /* 悬浮按钮，固定在左侧中间 */
    #cpamc-tool-btn {
      position: fixed; left: 0; top: 50%; transform: translateY(-50%);
      background: #1890ff; color: #fff; padding: 16px 8px;
      border-radius: 0 8px 8px 0; cursor: pointer; z-index: 9999;
      box-shadow: 2px 0 12px rgba(24,144,255,0.4); 
      font-size: 14px; writing-mode: vertical-lr; letter-spacing: 4px;
      transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      user-select: none; display: none;
    }
    #cpamc-tool-btn:hover { background: #40a9ff; left: 5px; box-shadow: 4px 0 16px rgba(24,144,255,0.5); }

    /* 全屏半透明遮罩层 */
    #cpamc-modal {
      display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0, 0, 0, 0.45); z-index: 10000;
      backdrop-filter: blur(4px); opacity: 0; transition: opacity 0.3s;
    }
    #cpamc-modal.show { display: block; opacity: 1; }

    /* 主控制面板区 */
    #cpamc-modal-content {
      position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0.95);
      background: #fff; width: 1260px; max-width: 97vw; height: 700px; max-height: 92vh;
      border-radius: 18px; box-shadow: 0 22px 64px rgba(15, 23, 42, 0.22);
      display: flex; flex-direction: column; overflow: hidden;
      transition: transform 0.3s;
    }
    #cpamc-modal.show #cpamc-modal-content { transform: translate(-50%, -50%) scale(1); }

    #cpamc-confirm-overlay {
      display: none; position: fixed; inset: 0; background: rgba(0, 0, 0, 0.35);
      z-index: 10001; align-items: center; justify-content: center;
    }
    #cpamc-confirm-overlay.show { display: flex; }
    #cpamc-confirm-dialog {
      width: min(780px, calc(100vw - 48px)); background: #fffdf9; border-radius: 24px;
      box-shadow: 0 18px 48px rgba(0,0,0,0.18); overflow: hidden; color: #3a332c;
      border: 1px solid rgba(60, 42, 16, 0.08);
    }
    .cpamc-confirm-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 28px 36px 18px; font-size: 24px; font-weight: 700;
      border-bottom: 1px solid rgba(60, 42, 16, 0.08);
    }
    .cpamc-confirm-close {
      width: 44px; height: 44px; border-radius: 50%; border: 1px solid rgba(60, 42, 16, 0.12);
      background: #fff; color: #7a6c5f; font-size: 28px; line-height: 1; cursor: pointer;
    }
    .cpamc-confirm-close:hover { color: #4f4338; border-color: rgba(60, 42, 16, 0.2); }
    .cpamc-confirm-body {
      padding: 56px 36px 28px; font-size: 18px; line-height: 1.7; white-space: pre-line;
    }
    .cpamc-confirm-actions {
      display: flex; justify-content: flex-end; gap: 18px; padding: 8px 36px 36px;
    }
    .cpamc-confirm-btn {
      min-width: 92px; height: 56px; border-radius: 14px; border: none; cursor: pointer;
      font-size: 18px; font-weight: 700; transition: transform 0.15s ease, opacity 0.15s ease;
    }
    .cpamc-confirm-btn:hover { transform: translateY(-1px); }
    .cpamc-confirm-btn.cancel { background: transparent; color: #7a6c5f; }
    .cpamc-confirm-btn.confirm { background: #cb5a45; color: #fff; }

    /* 顶部导航 */
    .cpamc-header {
      padding: 18px 28px; border-bottom: 1px solid #e8eef8;
      background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
      display: flex; justify-content: space-between; align-items: center;
    }
    .cpamc-header h2 { margin: 0; font-size: 18px; color: #1f2a37; font-weight: 700; letter-spacing: 0.01em; }
    .cpamc-close { cursor: pointer; font-size: 24px; color: #999; line-height: 1; }
    .cpamc-close:hover { color: #555; }

    /* 内部两个区域 */
    .cpamc-body { display: flex; flex: 1; overflow: hidden; background: #f6f9fc; }
    .cpamc-section { flex: 1; padding: 16px; overflow-y: auto; display: flex; flex-direction: column; }
    .cpamc-section:first-child { border-right: 1px solid #e6edf6; }

    .cpamc-section-header {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid #d8e7fb;
    }
    .cpamc-section-heading { display: flex; flex-direction: column; gap: 4px; }
    .cpamc-section-header h3 { margin: 0; font-size: 16px; color: #2a3546; font-weight: 700;}
    .cpamc-section-subtitle { display: none; }

    /* 列表与项 */
    .cpamc-list { display: flex; flex-direction: column; gap: 8px; }
    .cpamc-group-section { display: flex; flex-direction: column; gap: 8px; }
    .cpamc-group-title {
      display: flex; align-items: center; gap: 8px; margin: 2px 0 2px;
      font-size: 13px; font-weight: 700; color: #52627a;
    }
    .cpamc-group-title::before {
      content: ''; width: 6px; height: 6px; border-radius: 999px; background: #60a5fa;
      box-shadow: 0 0 0 4px rgba(96,165,250,0.12);
    }
    .cpamc-item {
      border: 1px solid #dfe7f1; border-radius: 12px; padding: 12px; background: #fff;
      transition: all 0.18s ease; box-shadow: none;
    }
    .cpamc-item:hover { border-color: #bfdbfe; background: #fcfdff; }
    .cpamc-item-head {
      display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 8px;
    }
    .cpamc-item-title-wrap { min-width: 0; flex: 1; }
    .cpamc-item-title {
      font-weight: 700; color: #1f2937; overflow-wrap: anywhere; font-size: 15px; line-height: 1.35;
    }
    .cpamc-item-subtitle {
      margin-top: 3px; font-size: 12px; line-height: 1.5; color: #64748b; overflow-wrap: anywhere;
    }
    .cpamc-item-status {
      font-size: 12px; color: #666; display: inline-flex; align-items: center; flex-shrink: 0;
      padding: 3px 8px; background: #f5f5f5; border-radius: 999px; font-weight: 700;
    }
    .cpamc-status-on { color: #52c41a; background: #f6ffed; border: 1px solid #b7eb8f; }
    .cpamc-status-off { color: #f5222d; background: #fff1f0; border: 1px solid #ffa39e; }
    .cpamc-status-warn { color: #d48806; background: #fffbe6; border: 1px solid #ffe58f; }
    .cpamc-status-busy { color: #0958d9; background: #e6f4ff; border: 1px solid #91caff; }
    .cpamc-status-idle { color: #475569; background: #f8fafc; border: 1px solid #cbd5e1; }
    .cpamc-meta-grid {
      display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 12px; margin-top: 2px;
    }
    .cpamc-meta-item {
      display: flex; align-items: baseline; gap: 6px; min-width: 0;
      padding: 0; border: none; background: transparent;
    }
    .cpamc-meta-item.wide { grid-column: 1 / -1; }
    .cpamc-meta-label {
      flex: 0 0 auto; font-size: 12px; line-height: 1.45; color: #94a3b8; font-weight: 700;
    }
    .cpamc-meta-value {
      min-width: 0; font-size: 12px; line-height: 1.5; color: #334155; word-break: break-all;
    }
    
    /* 按钮组 */
    .cpamc-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; margin-top: 10px; }
    .cpamc-btn {
      height: 36px; padding: 0 14px; border: 1px solid transparent; border-radius: 10px;
      cursor: pointer; font-size: 13px; font-weight: 600; transition: all 0.2s; outline: none;
    }
    .cpamc-btn.primary { background: #1890ff; color: #fff; }
    .cpamc-btn.primary:hover { background: #40a9ff; }
    .cpamc-btn.danger { background: #fff; border-color: #ff4d4f; color: #ff4d4f; }
    .cpamc-btn.danger:hover { background: #fff1f0; }
    .cpamc-btn.success { background: #52c41a; color: #fff; }
    .cpamc-btn.success:hover { background: #73d13d; }
    .cpamc-btn.default { background: #fff; border-color: #d9d9d9; color: #333; }
    .cpamc-btn.default:hover { border-color: #1890ff; color: #1890ff; }
    .cpamc-btn:disabled {
      cursor: not-allowed; opacity: 0.55; box-shadow: none;
    }
    .cpamc-auto-panel {
      margin: 0 0 12px; padding: 10px 12px; border: 1px solid #dfe7f1; border-radius: 14px;
      background: #fff;
      box-shadow: 0 4px 14px rgba(15,23,42,0.04);
    }
    .cpamc-auto-row {
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    }
    .cpamc-auto-row + .cpamc-auto-row {
      margin-top: 8px;
    }
    .cpamc-auto-row-head {
      justify-content: flex-start;
      align-items: center;
      gap: 8px;
      flex-wrap: nowrap;
    }
    .cpamc-auto-main {
      display: flex; align-items: center; gap: 6px; flex-wrap: nowrap; min-width: 0;
    }
    .cpamc-auto-actions {
      display: flex; align-items: center; gap: 6px; flex-wrap: nowrap; margin-left: auto;
    }
    .cpamc-auto-actions .cpamc-btn {
      min-width: 74px;
    }
    .cpamc-auto-status {
      display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 999px;
      font-size: 12px; font-weight: 700; background: #f5f5f5; color: #666;
    }
    .cpamc-auto-status.running { background: #f6ffed; color: #389e0d; border: 1px solid #b7eb8f; }
    .cpamc-auto-status.stopped { background: #fff1f0; color: #cf1322; border: 1px solid #ffa39e; }
    .cpamc-auto-status.busy { background: #e6f4ff; color: #0958d9; border: 1px solid #91caff; }
    .cpamc-auto-field {
      display: inline-flex; flex-direction: row; align-items: center; gap: 6px;
      font-size: 12px; color: #667085; background: transparent;
      border: none; border-radius: 0; padding: 0; width: auto; flex: 0 0 auto;
      white-space: nowrap;
    }
    .cpamc-auto-field input {
      width: 70px; height: 32px; padding: 0 8px; border: 1px solid #d9d9d9;
      border-radius: 8px; outline: none; font-size: 13px;
    }
    .cpamc-auto-field input:focus { border-color: #1890ff; box-shadow: 0 0 0 2px rgba(24,144,255,0.12); }
    .cpamc-auto-toggle {
      display: inline-flex; align-items: center; gap: 8px; min-height: 36px;
      padding: 6px 10px; border-radius: 999px; background: #f8fafc;
      border: 1px solid #e2e8f0; color: #3f4a5a; font-size: 12px;
      white-space: nowrap;
    }
    .cpamc-auto-toggle-wide { width: auto; max-width: none; justify-content: flex-start; align-items: center; }
    .cpamc-auto-toggle input {
      width: 16px; height: 16px; margin: 0; accent-color: #1890ff; cursor: pointer;
    }
    .cpamc-auto-toggle span {
      display: inline-flex; align-items: center; gap: 0; flex-direction: row;
    }
    .cpamc-auto-toggle small {
      display: none;
    }
    .cpamc-auto-hint {
      margin-top: 2px; font-size: 11px; color: #748198; line-height: 1.55;
    }
    @media (max-width: 960px) {
      #cpamc-modal-content { width: 94vw; height: 88vh; }
      .cpamc-body { flex-direction: column; }
      .cpamc-section:first-child { border-right: none; border-bottom: 1px solid #e6edf6; }
      .cpamc-meta-grid { grid-template-columns: 1fr; }
      .cpamc-item-head { flex-direction: column; align-items: flex-start; }
      .cpamc-auto-actions {
        width: auto;
        margin-left: 0;
      }
      .cpamc-auto-row-head {
        align-items: flex-start;
        flex-wrap: wrap;
      }
      .cpamc-auto-main { flex-wrap: wrap; }
      .cpamc-auto-actions { flex-wrap: wrap; }
      .cpamc-auto-toggle-wide {
        width: 100%;
        max-width: none;
      }
    }
    @media (max-width: 720px) {
      .cpamc-auto-row-head {
        flex-direction: column;
      }
      .cpamc-auto-main,
      .cpamc-auto-actions {
        width: 100%;
      }
    }
    
    .cpamc-loading-text { text-align: center; color: #999; padding: 20px; font-size: 14px; }
    .cpamc-missing-token-box { background: #fffbe6; border: 1px solid #ffe58f; padding: 15px; border-radius: 6px; text-align: left; }
    .cpamc-missing-token-box p { margin: 0 0 8px 0; color: #faad14; font-weight: bold;}
    .cpamc-missing-token-box span { font-size: 13px; color: #666;}
  `;
  document.head.appendChild(style);

  // 注入 DOM 元素
  const btn = document.createElement('div');
  btn.id = 'cpamc-tool-btn';
  btn.innerText = 'CPA Sentinel';
  btn.title = '打开 CPA Sentinel 巡检面板';
  document.body.appendChild(btn);

  // Modal 遮罩
  const modal = document.createElement('div');
  modal.id = 'cpamc-modal';
  modal.innerHTML = `
    <div id="cpamc-modal-content">
      <div class="cpamc-header">
        <h2>🚀 CPA Sentinel</h2>
        <span class="cpamc-close" id="cpamc-modal-close" title="关闭">&times;</span>
      </div>
      <div class="cpamc-body">
        <!-- 左侧：AI 供应商 -->
        <div class="cpamc-section">
          <div class="cpamc-section-header">
            <div class="cpamc-section-heading">
              <h3>AI 服务商检查</h3>
              <span class="cpamc-section-subtitle">统一管理探活、停用与恢复，减少手动干预。</span>
            </div>
          </div>
          <div class="cpamc-auto-panel">
            <div class="cpamc-auto-row cpamc-auto-row-head">
              <div class="cpamc-auto-main">
                <span class="cpamc-auto-status stopped" id="cpamc-provider-auto-status">已停止</span>
                <label class="cpamc-auto-toggle cpamc-auto-toggle-wide" for="cpamc-auto-manage-provider-health">
                  <input type="checkbox" id="cpamc-auto-manage-provider-health" />
                  <span>健康托管 <small>失败自动停用，恢复后自动启用</small></span>
                </label>
                <label class="cpamc-auto-field">
                  <span>间隔</span>
                  <input type="number" id="cpamc-provider-auto-scan-interval" min="10" max="3600" step="1" />
                </label>
                <label class="cpamc-auto-field">
                  <span>线程</span>
                  <input type="number" id="cpamc-provider-auto-scan-concurrency" min="1" max="10" step="1" />
                </label>
              </div>
              <div class="cpamc-auto-actions">
                <button class="cpamc-btn default" id="btn-refresh-providers">刷新列表</button>
                <button class="cpamc-btn success" id="btn-provider-auto-scan-toggle">启动</button>
              </div>
            </div>
            <div class="cpamc-auto-hint" id="cpamc-provider-auto-hint">服务商状态会异步回填到列表卡片，适合长时间后台巡检。</div>
          </div>
          <div class="cpamc-list" id="list-providers"></div>
        </div>
        
        <!-- 右侧：认证文件 -->
        <div class="cpamc-section">
          <div class="cpamc-section-header">
            <div class="cpamc-section-heading">
              <h3>认证文件检查</h3>
              <span class="cpamc-section-subtitle">按设定节奏验证认证有效性，并决定是否自动清理。</span>
            </div>
          </div>
          <div class="cpamc-auto-panel">
            <div class="cpamc-auto-row cpamc-auto-row-head">
              <div class="cpamc-auto-main">
                <span class="cpamc-auto-status stopped" id="cpamc-auto-scan-status">已停止</span>
                <label class="cpamc-auto-toggle cpamc-auto-toggle-wide" for="cpamc-auto-evict-invalid-auth">
                  <input type="checkbox" id="cpamc-auto-evict-invalid-auth" />
                  <span>自动清理 <small>扫描失败后直接移除无效认证</small></span>
                </label>
                <label class="cpamc-auto-field">
                  <span>间隔</span>
                  <input type="number" id="cpamc-auto-scan-interval" min="10" max="3600" step="1" />
                </label>
                <label class="cpamc-auto-field">
                  <span>线程</span>
                  <input type="number" id="cpamc-auto-scan-concurrency" min="1" max="10" step="1" />
                </label>
              </div>
              <div class="cpamc-auto-actions">
                <button class="cpamc-btn default" id="btn-refresh-auth">刷新列表</button>
                <button class="cpamc-btn success" id="btn-auto-scan-toggle">启动</button>
              </div>
            </div>
            <div class="cpamc-auto-hint" id="cpamc-auto-scan-hint">认证文件会按照设定并发自动检查，可选择是否自动清理异常项。</div>
          </div>
          <div class="cpamc-list" id="list-auth"></div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const confirmOverlay = document.createElement('div');
  confirmOverlay.id = 'cpamc-confirm-overlay';
  confirmOverlay.innerHTML = `
    <div id="cpamc-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="cpamc-confirm-title">
      <div class="cpamc-confirm-header">
        <div id="cpamc-confirm-title">删除认证文件</div>
        <button type="button" class="cpamc-confirm-close" id="cpamc-confirm-close" aria-label="关闭">×</button>
      </div>
      <div class="cpamc-confirm-body" id="cpamc-confirm-message"></div>
      <div class="cpamc-confirm-actions">
        <button type="button" class="cpamc-confirm-btn cancel" id="cpamc-confirm-cancel">取消</button>
        <button type="button" class="cpamc-confirm-btn confirm" id="cpamc-confirm-confirm">确认</button>
      </div>
    </div>
  `;
  document.body.appendChild(confirmOverlay);

  // 事件绑定与逻辑
  const closeBtn = document.getElementById('cpamc-modal-close');
  
  btn.onclick = () => {
    modal.classList.add('show');
    loadData();
  };
  
  closeBtn.onclick = () => modal.classList.remove('show');
  
  modal.onclick = (e) => {
    if (e.target === modal) modal.classList.remove('show');
  };

  const refreshProvidersBtn = document.getElementById('btn-refresh-providers');
  const refreshAuthBtn = document.getElementById('btn-refresh-auth');
  refreshProvidersBtn.onclick = () => loadProviders({ probe: false, source: 'manual' });
  refreshAuthBtn.onclick = () => loadAuthFiles({ verify: false, source: 'manual' });
  const autoScanStatusEl = document.getElementById('cpamc-auto-scan-status');
  const autoScanIntervalInput = document.getElementById('cpamc-auto-scan-interval');
  const autoScanConcurrencyInput = document.getElementById('cpamc-auto-scan-concurrency');
  const autoScanHintEl = document.getElementById('cpamc-auto-scan-hint');
  const providerAutoStatusEl = document.getElementById('cpamc-provider-auto-status');
  const providerAutoHintEl = document.getElementById('cpamc-provider-auto-hint');
  const providerAutoScanIntervalInput = document.getElementById('cpamc-provider-auto-scan-interval');
  const providerAutoScanConcurrencyInput = document.getElementById('cpamc-provider-auto-scan-concurrency');
  const autoManageProviderHealthCheckbox = document.getElementById('cpamc-auto-manage-provider-health');
  const providerAutoScanToggleBtn = document.getElementById('btn-provider-auto-scan-toggle');
  const autoEvictInvalidAuthCheckbox = document.getElementById('cpamc-auto-evict-invalid-auth');
  const autoScanToggleBtn = document.getElementById('btn-auto-scan-toggle');
  const confirmTitleEl = document.getElementById('cpamc-confirm-title');
  const confirmMessageEl = document.getElementById('cpamc-confirm-message');
  const confirmCloseBtn = document.getElementById('cpamc-confirm-close');
  const confirmCancelBtn = document.getElementById('cpamc-confirm-cancel');
  const confirmConfirmBtn = document.getElementById('cpamc-confirm-confirm');
  let confirmResolver = null;
  let providerAutoScanTimer = null;
  let providerAutoScanInProgress = false;
  let providerAutoScanLastRunAt = '';
  let providerAutoScanSessionId = 0;
  let autoScanTimer = null;
  let autoScanInProgress = false;
  let autoScanLastRunAt = '';
  let autoScanSessionId = 0;
  let providerLoadSeq = 0;
  let providerListLoading = false;
  let authLoadSeq = 0;
  let authListLoading = false;

  function closeConfirmDialog(result) {
    confirmOverlay.classList.remove('show');
    if (confirmResolver) {
      const resolver = confirmResolver;
      confirmResolver = null;
      resolver(result);
    }
  }

  function showConfirmDialog(options) {
    const opts = options || {};
    confirmTitleEl.textContent = opts.title || '删除认证文件';
    confirmMessageEl.textContent = opts.message || '';
    confirmCancelBtn.textContent = opts.cancelText || '取消';
    confirmConfirmBtn.textContent = opts.confirmText || '确认';
    confirmCancelBtn.style.display = opts.singleAction ? 'none' : '';
    confirmOverlay.classList.add('show');
    return new Promise(resolve => {
      confirmResolver = resolve;
    });
  }

  function showMessageDialog(options) {
    return showConfirmDialog({
      title: options?.title || '提示',
      message: options?.message || '',
      confirmText: options?.confirmText || '确定',
      singleAction: true
    });
  }

  confirmCloseBtn.onclick = () => closeConfirmDialog(false);
  confirmCancelBtn.onclick = () => closeConfirmDialog(false);
  confirmConfirmBtn.onclick = () => closeConfirmDialog(true);
  confirmOverlay.onclick = (e) => {
    if (e.target === confirmOverlay) closeConfirmDialog(false);
  };

  function clampInt(value, min, max, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, Math.round(num)));
  }

  function getAutoScanIntervalSeconds() {
    return clampInt(
      localStorage.getItem(AUTO_SCAN_INTERVAL_KEY),
      MIN_AUTO_SCAN_INTERVAL_SECONDS,
      MAX_AUTO_SCAN_INTERVAL_SECONDS,
      DEFAULT_AUTO_SCAN_INTERVAL_SECONDS
    );
  }

  function getAutoScanConcurrency() {
    return clampInt(
      localStorage.getItem(AUTO_SCAN_CONCURRENCY_KEY),
      MIN_AUTO_SCAN_CONCURRENCY,
      MAX_AUTO_SCAN_CONCURRENCY,
      DEFAULT_AUTO_SCAN_CONCURRENCY
    );
  }

  function isAutoScanEnabled() {
    return localStorage.getItem(AUTO_SCAN_ENABLED_KEY) === 'true';
  }

  function getProviderAutoScanIntervalSeconds() {
    return clampInt(
      localStorage.getItem(AUTO_PROVIDER_SCAN_INTERVAL_KEY),
      MIN_AUTO_SCAN_INTERVAL_SECONDS,
      MAX_AUTO_SCAN_INTERVAL_SECONDS,
      DEFAULT_AUTO_SCAN_INTERVAL_SECONDS
    );
  }

  function getProviderAutoScanConcurrency() {
    return clampInt(
      localStorage.getItem(AUTO_PROVIDER_SCAN_CONCURRENCY_KEY),
      MIN_AUTO_SCAN_CONCURRENCY,
      MAX_AUTO_SCAN_CONCURRENCY,
      DEFAULT_AUTO_SCAN_CONCURRENCY
    );
  }

  function isProviderAutoScanEnabled() {
    return localStorage.getItem(AUTO_PROVIDER_SCAN_ENABLED_KEY) === 'true';
  }

  function isAutoDisableInvalidProviderEnabled() {
    return localStorage.getItem(AUTO_DISABLE_INVALID_PROVIDER_KEY) === 'true';
  }

  function isAutoEnableRecoveredProviderEnabled() {
    return localStorage.getItem(AUTO_ENABLE_RECOVERED_PROVIDER_KEY) === 'true';
  }

  function isProviderHealthManagedEnabled() {
    return isAutoDisableInvalidProviderEnabled() || isAutoEnableRecoveredProviderEnabled();
  }

  function isAutoEvictInvalidAuthEnabled() {
    return localStorage.getItem(AUTO_EVICT_INVALID_AUTH_KEY) === 'true';
  }

  function persistAutoScanSettings() {
    const intervalSeconds = clampInt(
      autoScanIntervalInput.value,
      MIN_AUTO_SCAN_INTERVAL_SECONDS,
      MAX_AUTO_SCAN_INTERVAL_SECONDS,
      DEFAULT_AUTO_SCAN_INTERVAL_SECONDS
    );
    const concurrency = clampInt(
      autoScanConcurrencyInput.value,
      MIN_AUTO_SCAN_CONCURRENCY,
      MAX_AUTO_SCAN_CONCURRENCY,
      DEFAULT_AUTO_SCAN_CONCURRENCY
    );
    autoScanIntervalInput.value = String(intervalSeconds);
    autoScanConcurrencyInput.value = String(concurrency);
    localStorage.setItem(AUTO_SCAN_INTERVAL_KEY, String(intervalSeconds));
    localStorage.setItem(AUTO_SCAN_CONCURRENCY_KEY, String(concurrency));
    return { intervalSeconds, concurrency };
  }

  function persistProviderAutoScanSettings() {
    const intervalSeconds = clampInt(
      providerAutoScanIntervalInput.value,
      MIN_AUTO_SCAN_INTERVAL_SECONDS,
      MAX_AUTO_SCAN_INTERVAL_SECONDS,
      DEFAULT_AUTO_SCAN_INTERVAL_SECONDS
    );
    const concurrency = clampInt(
      providerAutoScanConcurrencyInput.value,
      MIN_AUTO_SCAN_CONCURRENCY,
      MAX_AUTO_SCAN_CONCURRENCY,
      DEFAULT_AUTO_SCAN_CONCURRENCY
    );
    providerAutoScanIntervalInput.value = String(intervalSeconds);
    providerAutoScanConcurrencyInput.value = String(concurrency);
    localStorage.setItem(AUTO_PROVIDER_SCAN_INTERVAL_KEY, String(intervalSeconds));
    localStorage.setItem(AUTO_PROVIDER_SCAN_CONCURRENCY_KEY, String(concurrency));
    return { intervalSeconds, concurrency };
  }

  function updateProviderAutoScanControls() {
    const enabled = isProviderAutoScanEnabled();
    const intervalSeconds = getProviderAutoScanIntervalSeconds();
    const concurrency = getProviderAutoScanConcurrency();
    const autoManage = isProviderHealthManagedEnabled();
    const providerBusy = providerAutoScanInProgress;
    const providerLocked = enabled || providerBusy;
    providerAutoScanIntervalInput.value = String(intervalSeconds);
    providerAutoScanConcurrencyInput.value = String(concurrency);
    autoManageProviderHealthCheckbox.checked = autoManage;
    providerAutoScanIntervalInput.disabled = providerLocked;
    providerAutoScanConcurrencyInput.disabled = providerLocked;
    autoManageProviderHealthCheckbox.disabled = providerLocked;

    let statusClass = 'stopped';
    let statusText = '已停止';
    if (providerBusy) {
      statusClass = 'busy';
      statusText = '扫描中';
    } else if (enabled) {
      statusClass = 'running';
      statusText = '运行中';
    }

    providerAutoStatusEl.className = `cpamc-auto-status ${statusClass}`;
    providerAutoStatusEl.textContent = statusText;
    refreshProvidersBtn.disabled = enabled || providerAutoScanInProgress || providerListLoading;
    refreshProvidersBtn.textContent = providerListLoading ? '加载中' : '刷新列表';
    refreshProvidersBtn.title = enabled
      ? '自动巡检运行中，列表会自动回刷'
      : (providerListLoading ? '服务商列表正在加载' : '仅刷新列表，不会自动探活');
    providerAutoScanToggleBtn.disabled = providerListLoading || (providerAutoScanInProgress && !enabled);
    providerAutoScanToggleBtn.textContent = enabled ? '停止' : '启动';
    providerAutoScanToggleBtn.className = `cpamc-btn ${enabled ? 'danger' : 'success'}`;

    const detailParts = [
      `间隔 ${intervalSeconds} 秒`,
      `线程 ${concurrency}`,
      autoManage ? '健康托管已开启' : '健康托管已关闭'
    ];
    if (providerAutoScanLastRunAt) detailParts.push(`上次 ${providerAutoScanLastRunAt}`);
    providerAutoHintEl.textContent = enabled
      ? `服务商自动检查已启动，${detailParts.join(' · ')}。开启健康托管后，失败会自动停用，恢复后会自动启用。`
      : `服务商自动检查未启动，当前配置：${detailParts.join(' · ')}。当前仅展示配置；点击“刷新列表”不会自动探活，点击“启动”后才会按设定执行检查。`;
  }

  function updateAuthAutoScanControls() {
    const enabled = isAutoScanEnabled();
    const intervalSeconds = getAutoScanIntervalSeconds();
    const concurrency = getAutoScanConcurrency();
    const authLocked = enabled || autoScanInProgress;
    autoScanIntervalInput.value = String(intervalSeconds);
    autoScanConcurrencyInput.value = String(concurrency);
    autoEvictInvalidAuthCheckbox.checked = isAutoEvictInvalidAuthEnabled();
    autoScanIntervalInput.disabled = authLocked;
    autoScanConcurrencyInput.disabled = authLocked;
    autoEvictInvalidAuthCheckbox.disabled = authLocked;

    let statusClass = 'stopped';
    let statusText = '已停止';
    if (autoScanInProgress) {
      statusClass = 'busy';
      statusText = '扫描中';
    } else if (enabled) {
      statusClass = 'running';
      statusText = '运行中';
    }
    autoScanStatusEl.className = `cpamc-auto-status ${statusClass}`;
    autoScanStatusEl.textContent = statusText;
    autoScanToggleBtn.disabled = autoScanInProgress && !enabled;
    autoScanToggleBtn.textContent = enabled ? '停止' : '启动';
    autoScanToggleBtn.className = `cpamc-btn ${enabled ? 'danger' : 'success'}`;
    refreshAuthBtn.disabled = enabled || autoScanInProgress || authListLoading;
    refreshAuthBtn.textContent = authListLoading ? '加载中' : '刷新列表';
    refreshAuthBtn.title = enabled
      ? '自动巡检运行中，列表会自动回刷'
      : (authListLoading ? '认证文件列表正在加载' : '仅刷新列表，不会全量验证');

    const detailParts = [
      `间隔 ${intervalSeconds} 秒`,
      `线程 ${concurrency}`,
      autoEvictInvalidAuthCheckbox.checked ? '自动清理已开启' : '自动清理已关闭'
    ];
    if (autoScanLastRunAt) detailParts.push(`上次 ${autoScanLastRunAt}`);
    if (enabled) {
      autoScanHintEl.textContent = `认证文件自动检查已启动，${detailParts.join(' · ')}。当前会按设定间隔巡检认证文件，并按勾选策略决定是否清理无效认证。`;
    } else {
      autoScanHintEl.textContent = `认证文件自动检查未启动，当前配置：${detailParts.join(' · ')}。当前仅展示配置；点击“刷新列表”不会自动验证全部认证。`;
    }
  }

  function updateAutoScanControls() {
    updateProviderAutoScanControls();
    updateAuthAutoScanControls();
  }

  function clearProviderAutoScanTimer() {
    if (providerAutoScanTimer) {
      clearTimeout(providerAutoScanTimer);
      providerAutoScanTimer = null;
    }
  }

  function clearAutoScanTimer() {
    if (autoScanTimer) {
      clearTimeout(autoScanTimer);
      autoScanTimer = null;
    }
  }

  function isProviderAutoScanSessionActive(sessionId) {
    return isProviderAutoScanEnabled() && sessionId === providerAutoScanSessionId;
  }

  function isAuthAutoScanSessionActive(sessionId) {
    return isAutoScanEnabled() && sessionId === autoScanSessionId;
  }
  
  function getManagementKey() {
    return localStorage.getItem('managementKey') || sessionStorage.getItem('managementKey') || localStorage.getItem('cpamc_custom_token') || '';
  }

  function getCurrentRoutePath() {
    const hash = String(window.location.hash || '').trim();
    if (hash.startsWith('#/')) return hash.slice(1);

    const path = String(window.location.pathname || '').trim();
    if (!path) return '/';
    if (path === '/management.html' || path.endsWith('/management.html')) return '/';
    return path;
  }

  function isLoginRoute() {
    const routePath = getCurrentRoutePath();
    return routePath === '/login' || routePath.startsWith('/login/');
  }

  function hasManagementShell() {
    return !!(
      document.querySelector('.app-shell .sidebar') ||
      document.querySelector('.main-body .sidebar') ||
      document.querySelector('.sidebar .nav-item') ||
      document.querySelector('a[href="/config"]') ||
      document.querySelector('a[href="/ai-providers"]') ||
      document.querySelector('a[href="/auth-files"]') ||
      document.querySelector('a[href$="#/config"]') ||
      document.querySelector('a[href$="#/ai-providers"]') ||
      document.querySelector('a[href$="#/auth-files"]')
    );
  }

  function hasLoginForm() {
    return !!(
      document.querySelector('input[type="password"]') ||
      document.querySelector('form[action*="login"]') ||
      document.querySelector('input[placeholder*="管理密钥"]')
    );
  }

  function updateToolVisibility() {
    const visible = hasManagementShell() || (!isLoginRoute() && !hasLoginForm());
    btn.style.display = visible ? 'block' : 'none';
    if (!visible) modal.classList.remove('show');
  }

  function getReqInfo() {
    // 无论是哪种方式获取，只要有 token 就可以返回
    let managementKey = getManagementKey();
    
    if (!managementKey) {
        return null; // 这里静默返回 null，让 UI 渲染未捕获的状态
    }
    
    return {
      apiBase: '', 
      headers: {
        'Authorization': 'Bearer ' + managementKey,
        'Content-Type': 'application/json'
      }
    };
  }

  function loadData() {
    updateAutoScanControls();
    loadProviders({ probe: isProviderAutoScanEnabled(), source: 'panel-open' });
    loadAuthFiles({ verify: isAutoScanEnabled(), source: 'panel-open' });
  }

  async function triggerProviderAutoScan(options = {}) {
    const opts = typeof options === 'string' ? { reason: options } : (options || {});
    const reason = opts.reason || 'manual';
    const sessionId = typeof opts.sessionId === 'number' ? opts.sessionId : providerAutoScanSessionId;
    if ((reason === 'timer' || reason === 'start') && !isProviderAutoScanSessionActive(sessionId)) {
      return false;
    }
    if (providerAutoScanInProgress) return false;
    providerAutoScanInProgress = true;
    updateAutoScanControls();
    try {
      await backgroundProviderCheck({ sessionId });
      if (!isProviderAutoScanSessionActive(sessionId)) return false;
      providerAutoScanLastRunAt = new Date().toLocaleString();
      return true;
    } finally {
      providerAutoScanInProgress = false;
      updateAutoScanControls();
      if (modal.classList.contains('show') || reason !== 'timer') {
        loadProviders({
          probe: false,
          source: reason
        });
      }
    }
  }

  async function triggerAutoScan(options = {}) {
    const opts = typeof options === 'string' ? { reason: options } : (options || {});
    const reason = opts.reason || 'manual';
    const sessionId = typeof opts.sessionId === 'number' ? opts.sessionId : autoScanSessionId;
    const allowDelete = typeof opts.allowDelete === 'boolean'
      ? opts.allowDelete
      : isAutoEvictInvalidAuthEnabled();
    if ((reason === 'timer' || reason === 'start') && !isAuthAutoScanSessionActive(sessionId)) {
      return false;
    }
    if (autoScanInProgress) return false;
    autoScanInProgress = true;
    updateAutoScanControls();
    try {
      if (modal.classList.contains('show') || reason !== 'timer') {
        await loadAuthFiles({
          verify: false,
          checking: true,
          source: `${reason}-checking`
        });
      }
      await backgroundAuthCheck({ allowDelete, sessionId });
      if (!isAuthAutoScanSessionActive(sessionId)) return false;
      autoScanLastRunAt = new Date().toLocaleString();
      return true;
    } finally {
      autoScanInProgress = false;
      updateAutoScanControls();
      if (modal.classList.contains('show') || reason !== 'timer') {
        loadAuthFiles({
          verify: false,
          source: reason
        });
      }
    }
  }

  function scheduleNextProviderAutoScan(delayMs, sessionId = providerAutoScanSessionId) {
    clearProviderAutoScanTimer();
    if (!isProviderAutoScanSessionActive(sessionId)) {
      updateAutoScanControls();
      return;
    }
    const waitMs = typeof delayMs === 'number' ? delayMs : getProviderAutoScanIntervalSeconds() * 1000;
    providerAutoScanTimer = setTimeout(async () => {
      await triggerProviderAutoScan({ reason: 'timer', sessionId });
      if (isProviderAutoScanSessionActive(sessionId)) {
        scheduleNextProviderAutoScan(undefined, sessionId);
      }
    }, waitMs);
    updateAutoScanControls();
  }

  function scheduleNextAutoScan(delayMs, sessionId = autoScanSessionId) {
    clearAutoScanTimer();
    if (!isAuthAutoScanSessionActive(sessionId)) {
      updateAutoScanControls();
      return;
    }
    const waitMs = typeof delayMs === 'number' ? delayMs : getAutoScanIntervalSeconds() * 1000;
    autoScanTimer = setTimeout(async () => {
      await triggerAutoScan({ reason: 'timer', sessionId });
      if (isAuthAutoScanSessionActive(sessionId)) {
        scheduleNextAutoScan(undefined, sessionId);
      }
    }, waitMs);
    updateAutoScanControls();
  }

  function startProviderAutoScan() {
    persistProviderAutoScanSettings();
    localStorage.setItem(AUTO_PROVIDER_SCAN_ENABLED_KEY, 'true');
    providerAutoScanSessionId += 1;
    const sessionId = providerAutoScanSessionId;
    triggerProviderAutoScan({ reason: 'start', sessionId }).finally(() => {
      if (isProviderAutoScanSessionActive(sessionId)) {
        scheduleNextProviderAutoScan(getProviderAutoScanIntervalSeconds() * 1000, sessionId);
      }
    });
  }

  function stopProviderAutoScan() {
    localStorage.setItem(AUTO_PROVIDER_SCAN_ENABLED_KEY, 'false');
    providerAutoScanSessionId += 1;
    clearProviderAutoScanTimer();
    updateAutoScanControls();
  }

  function startAutoScan() {
    persistAutoScanSettings();
    localStorage.setItem(AUTO_SCAN_ENABLED_KEY, 'true');
    autoScanSessionId += 1;
    const sessionId = autoScanSessionId;
    triggerAutoScan({ reason: 'start', sessionId }).finally(() => {
      if (isAuthAutoScanSessionActive(sessionId)) {
        scheduleNextAutoScan(getAutoScanIntervalSeconds() * 1000, sessionId);
      }
    });
  }

  function stopAutoScan() {
    localStorage.setItem(AUTO_SCAN_ENABLED_KEY, 'false');
    autoScanSessionId += 1;
    clearAutoScanTimer();
    updateAutoScanControls();
  }

  providerAutoScanIntervalInput.value = String(getProviderAutoScanIntervalSeconds());
  providerAutoScanConcurrencyInput.value = String(getProviderAutoScanConcurrency());
  autoScanIntervalInput.value = String(getAutoScanIntervalSeconds());
  autoScanConcurrencyInput.value = String(getAutoScanConcurrency());
  providerAutoScanIntervalInput.onchange = () => {
    persistProviderAutoScanSettings();
    if (isProviderAutoScanEnabled()) scheduleNextProviderAutoScan(getProviderAutoScanIntervalSeconds() * 1000, providerAutoScanSessionId);
    updateAutoScanControls();
  };
  providerAutoScanConcurrencyInput.onchange = () => {
    persistProviderAutoScanSettings();
    updateAutoScanControls();
  };
  autoManageProviderHealthCheckbox.onchange = () => {
    const nextValue = autoManageProviderHealthCheckbox.checked ? 'true' : 'false';
    localStorage.setItem(AUTO_DISABLE_INVALID_PROVIDER_KEY, nextValue);
    localStorage.setItem(AUTO_ENABLE_RECOVERED_PROVIDER_KEY, nextValue);
    updateAutoScanControls();
  };
  autoScanIntervalInput.onchange = () => {
    persistAutoScanSettings();
    if (isAutoScanEnabled()) scheduleNextAutoScan(getAutoScanIntervalSeconds() * 1000, autoScanSessionId);
    updateAutoScanControls();
  };
  autoScanConcurrencyInput.onchange = () => {
    persistAutoScanSettings();
    updateAutoScanControls();
  };
  autoEvictInvalidAuthCheckbox.onchange = () => {
    localStorage.setItem(AUTO_EVICT_INVALID_AUTH_KEY, autoEvictInvalidAuthCheckbox.checked ? 'true' : 'false');
    updateAutoScanControls();
  };
  providerAutoScanToggleBtn.onclick = () => {
    if (isProviderAutoScanEnabled()) {
      stopProviderAutoScan();
      return;
    }
    startProviderAutoScan();
  };
  autoScanToggleBtn.onclick = () => {
    if (isAutoScanEnabled()) {
      stopAutoScan();
      return;
    }
    startAutoScan();
  };
  updateAutoScanControls();

  window.addEventListener('hashchange', () => {
    updateToolVisibility();
    setTimeout(updateToolVisibility, 120);
  });
  window.addEventListener('storage', () => {
    updateToolVisibility();
    updateAutoScanControls();
    if (isProviderAutoScanEnabled()) {
      scheduleNextProviderAutoScan(getProviderAutoScanIntervalSeconds() * 1000, providerAutoScanSessionId);
    } else {
      providerAutoScanSessionId += 1;
      clearProviderAutoScanTimer();
    }
    if (isAutoScanEnabled()) {
      scheduleNextAutoScan(getAutoScanIntervalSeconds() * 1000, autoScanSessionId);
    } else {
      autoScanSessionId += 1;
      clearAutoScanTimer();
    }
  });
  window.addEventListener('focus', () => {
    updateToolVisibility();
    updateAutoScanControls();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) updateToolVisibility();
  });
  window.addEventListener('pageshow', () => {
    updateToolVisibility();
  });
  const toolVisibilityObserver = new MutationObserver(() => updateToolVisibility());
  toolVisibilityObserver.observe(document.body, { childList: true, subtree: true });
  if (isProviderAutoScanEnabled()) scheduleNextProviderAutoScan(getProviderAutoScanIntervalSeconds() * 1000, providerAutoScanSessionId);
  if (isAutoScanEnabled()) scheduleNextAutoScan(getAutoScanIntervalSeconds() * 1000, autoScanSessionId);
  updateToolVisibility();

  function getMissingTokenHTML() {
      return `
        <div class="cpamc-missing-token-box">
          <p>⏳ 等待自动同步授权...</p>
          <span>这是因为 CPAMC 的前端框架把您的登录状态藏在了内存里。</span><br/>
          <span><b>解决办法：</b>请您在这个窗口之外的 CPAMC <b>原版界面上，随便点一下左侧的任何一个菜单（比如“AI 提供商”或“仪表盘”）</b>。点一次之后，我就会瞬间自动截获并同步您的登录凭证！然后再点击本面板右上角的【刷新数据】即可成功拉取！</span>
        </div>
      `;
  }

  function extractList(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];
    if (Array.isArray(payload.files)) return payload.files;
    if (Array.isArray(payload.data)) return payload.data;
    if (Array.isArray(payload.items)) return payload.items;
    return [];
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDateTime(value) {
    if (!value) return '';
    const asNumber = Number(value);
    const date = Number.isFinite(asNumber) && !Number.isNaN(asNumber)
      ? new Date(asNumber < 1e12 ? asNumber * 1000 : asNumber)
      : new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }

  function getAuthFileId(file) {
    return file?.id || file?.name || file?.path || '';
  }

  function getAuthFileDeleteName(file) {
    return String(file?.name || file?.id || '').trim();
  }

  function isAuthFileValid(file) {
    if (typeof file?.valid === 'boolean') return file.valid;
    if (typeof file?.unavailable === 'boolean') return !file.unavailable;
    if (typeof file?.disabled === 'boolean') return !file.disabled;

    const status = String(file?.status ?? '').trim().toLowerCase();
    if (status) {
      return !['invalid', 'expired', 'disabled', 'inactive', 'unavailable', 'error', 'failed'].includes(status);
    }

    return true;
  }

  function getAuthFileStatusInfo(file, isValid) {
    const rawStatus = String(file?.status ?? '').trim();
    const statusMessage = String(file?.status_message ?? file?.statusMessage ?? '').trim();

    if (statusMessage) {
      return {
        text: getAuthVerificationLabel(file?.status_code ?? file?.statusCode, statusMessage),
        detailText: statusMessage
      };
    }

    if (rawStatus) {
      return {
        text: rawStatus,
        detailText: ''
      };
    }

    if (typeof file?.disabled === 'boolean') {
      return {
        text: file.disabled ? '已禁用' : '状态有效',
        detailText: ''
      };
    }

    if (typeof file?.unavailable === 'boolean') {
      return {
        text: file.unavailable ? '不可用' : '状态有效',
        detailText: ''
      };
    }

    return {
      text: isValid ? '状态有效' : '已失效 (建议清理)',
      detailText: ''
    };
  }

  function getAuthVerificationLabel(statusCode, detailText) {
    const code = Number(statusCode || 0);
    const detail = String(detailText || '').trim();
    if (isAuthIssueText(detail) || code === 401 || code === 403) return '认证失效';
    if (isQuotaIssueText(detail) || code === 429) return '额度受限';
    if (code === 404) return '接口不存在';
    if (code >= 400 && code < 600) return '验证失败';
    if (detail) return '验证异常';
    return '状态异常';
  }

  function buildAuthFileMeta(file) {
    const meta = [];
    const accountType = file?.account_type || file?.type;
    const planType = file?.id_token?.plan_type;
    const lastRefresh = formatDateTime(file?.last_refresh);
    const updatedAt = formatDateTime(file?.updated_at || file?.modtime);

    if (accountType) meta.push(`类型: ${accountType}`);
    if (planType) meta.push(`套餐: ${planType}`);
    if (lastRefresh) meta.push(`刷新: ${lastRefresh}`);
    if (updatedAt) meta.push(`更新: ${updatedAt}`);

    return meta;
  }

  function getAuthFileDisplayName(file) {
    return String(
      file?.account ||
      file?.email ||
      file?.label ||
      file?.name ||
      file?.id ||
      '未知认证文件'
    ).trim();
  }

  function buildMetaGridHtml(metaLines) {
    if (!Array.isArray(metaLines) || metaLines.length === 0) return '';
    const wideLabels = new Set(['地址', '探活详情', '排除模型', '验证', '验证详情', '上次探活', '来源', '刷新', '更新']);
    const itemsHtml = metaLines.map((line) => {
      const raw = String(line ?? '').trim();
      const splitIndex = raw.indexOf(':');
      const label = splitIndex > -1 ? raw.slice(0, splitIndex).trim() : '信息';
      const value = splitIndex > -1 ? raw.slice(splitIndex + 1).trim() : raw;
      const isWide = wideLabels.has(label) || value.length > 54;
      return `
        <div class="cpamc-meta-item${isWide ? ' wide' : ''}">
          <div class="cpamc-meta-label">${escapeHtml(label)}</div>
          <div class="cpamc-meta-value">${escapeHtml(value || '-')}</div>
        </div>
      `;
    }).join('');
    return `<div class="cpamc-meta-grid">${itemsHtml}</div>`;
  }

  function getAuthProvider(file) {
    return String(file?.provider || file?.type || 'unknown').trim().toLowerCase() || 'unknown';
  }

  function formatProviderLabel(provider) {
    const key = String(provider || '').trim().toLowerCase();
    if (!key) return 'Unknown';
    if (key === 'codex') return 'Codex';
    if (key === 'gemini') return 'Gemini';
    if (key === 'claude') return 'Claude';
    return key.charAt(0).toUpperCase() + key.slice(1);
  }

  function extractNamedArray(payload, key) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];
    if (key && Array.isArray(payload[key])) return payload[key];

    for (const value of Object.values(payload)) {
      if (Array.isArray(value)) return value;
    }

    return [];
  }

  function maskSecret(value, visibleCount = 4) {
    const text = String(value ?? '').trim();
    if (!text) return '未设置';
    if (text.length <= visibleCount * 2) return text;
    return `${text.slice(0, visibleCount)}******${text.slice(-visibleCount)}`;
  }

  function formatUrlHost(value) {
    const text = String(value ?? '').trim();
    if (!text) return '';
    try {
      return new URL(text).host || text;
    } catch (_) {
      return text;
    }
  }

  function formatPercent(numerator, denominator) {
    const total = Number(denominator || 0);
    if (!Number.isFinite(total) || total <= 0) return '0%';
    const value = (Number(numerator || 0) / total) * 100;
    if (!Number.isFinite(value) || value <= 0) return '0%';
    if (value >= 100) return '100%';
    return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
  }

  function getProviderDefinitions() {
    return [
      { type: 'gemini', label: 'Gemini', configKey: 'gemini-api-key', endpoint: '/v0/management/gemini-api-key' },
      { type: 'codex', label: 'Codex', configKey: 'codex-api-key', endpoint: '/v0/management/codex-api-key' },
      { type: 'claude', label: 'Claude', configKey: 'claude-api-key', endpoint: '/v0/management/claude-api-key' }
    ];
  }

  function getProviderApiKey(entry) {
    return String(entry?.['api-key'] ?? entry?.apiKey ?? '').trim();
  }

  function getProviderHealthStatsStore() {
    try {
      const raw = localStorage.getItem(PROVIDER_HEALTH_STATS_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function saveProviderHealthStatsStore(store) {
    try {
      localStorage.setItem(PROVIDER_HEALTH_STATS_KEY, JSON.stringify(store || {}));
    } catch (_) {}
  }

  function getProviderHealthIdentity(type, entry) {
    const apiKey = getProviderApiKey(entry);
    const baseUrl = getProviderBaseUrl(type, entry);
    return `${String(type || '').trim()}::${baseUrl}::${apiKey}`;
  }

  function getDefaultProviderHealthStats() {
    return {
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      lastProbeOk: null,
      lastProbeClassName: '',
      lastProbeText: '',
      lastProbeDetailText: '',
      lastProbeAt: '',
      lastAction: ''
    };
  }

  function getProviderHealthStats(type, entry) {
    const store = getProviderHealthStatsStore();
    const identity = getProviderHealthIdentity(type, entry);
    const saved = store[identity];
    if (!saved || typeof saved !== 'object') {
      return getDefaultProviderHealthStats();
    }
    return {
      ...getDefaultProviderHealthStats(),
      ...saved
    };
  }

  function setProviderHealthStats(type, entry, nextStats) {
    const store = getProviderHealthStatsStore();
    const identity = getProviderHealthIdentity(type, entry);
    store[identity] = {
      ...getDefaultProviderHealthStats(),
      ...(nextStats || {})
    };
    saveProviderHealthStatsStore(store);
    return store[identity];
  }

  function storeProviderProbeSnapshot(type, entry, verification) {
    const prev = getProviderHealthStats(type, entry);
    return setProviderHealthStats(type, entry, {
      ...prev,
      lastProbeOk: verification?.ok === true,
      lastProbeClassName: verification?.className || (verification?.ok ? 'cpamc-status-on' : 'cpamc-status-warn'),
      lastProbeText: String(verification?.text || '').trim(),
      lastProbeDetailText: String(verification?.detailText || '').trim(),
      lastProbeAt: verification?.checkedAt || new Date().toLocaleString()
    });
  }

  function getProviderDisableFailureThreshold(usageStats) {
    const totalRequests = Number(usageStats?.totalRequests || 0);
    const successRequests = Number(usageStats?.successRequests || 0);
    if (totalRequests <= 0) return DEFAULT_PROVIDER_DISABLE_FAILURE_THRESHOLD;
    const successRate = successRequests / totalRequests;
    if (
      totalRequests >= HIGH_SUCCESS_PROVIDER_MIN_REQUESTS &&
      Number.isFinite(successRate) &&
      successRate >= HIGH_SUCCESS_PROVIDER_RATE_THRESHOLD
    ) {
      return HIGH_SUCCESS_PROVIDER_DISABLE_FAILURE_THRESHOLD;
    }
    return DEFAULT_PROVIDER_DISABLE_FAILURE_THRESHOLD;
  }

  function updateProviderHealthStats(type, entry, verification, usageStats, options = {}) {
    const prev = getProviderHealthStats(type, entry);
    const disabled = options?.disabled === true;
    const next = {
      ...prev,
      lastProbeOk: verification?.ok === true,
      lastProbeClassName: verification?.className || (verification?.ok ? 'cpamc-status-on' : 'cpamc-status-warn'),
      lastProbeText: String(verification?.text || '').trim(),
      lastProbeDetailText: String(verification?.detailText || '').trim(),
      lastProbeAt: verification?.checkedAt || new Date().toLocaleString(),
      lastAction: ''
    };

    if (verification?.ok) {
      next.consecutiveFailures = 0;
      next.consecutiveSuccesses = disabled ? (prev.consecutiveSuccesses + 1) : 0;
    } else {
      next.consecutiveFailures = disabled ? 0 : (prev.consecutiveFailures + 1);
      next.consecutiveSuccesses = 0;
    }

    next.disableFailureThreshold = getProviderDisableFailureThreshold(usageStats);
    next.recoverySuccessThreshold = PROVIDER_RECOVERY_SUCCESS_THRESHOLD;
    return setProviderHealthStats(type, entry, next);
  }

  function findProviderEntryIndex(definition, items, targetEntry) {
    const targetApiKey = getProviderApiKey(targetEntry);
    const targetBaseUrl = getProviderBaseUrl(definition.type, targetEntry);
    return (Array.isArray(items) ? items : []).findIndex((entry) => {
      return getProviderApiKey(entry) === targetApiKey
        && getProviderBaseUrl(definition.type, entry) === targetBaseUrl;
    });
  }

  function syncProviderEntrySnapshot(targetEntry, nextEntry) {
    if (!targetEntry || !nextEntry || typeof targetEntry !== 'object' || typeof nextEntry !== 'object') {
      return;
    }
    Object.keys(targetEntry).forEach((key) => {
      if (!(key in nextEntry)) delete targetEntry[key];
    });
    Object.entries(nextEntry).forEach(([key, value]) => {
      targetEntry[key] = value;
    });
  }

  async function fetchProviderUsageSummary(info) {
    try {
      const res = await fetch(info.apiBase + '/v0/management/usage', { headers: info.headers });
      if (!res.ok) return new Map();
      const payload = await res.json();
      const apis = payload?.usage?.apis;
      if (!apis || typeof apis !== 'object') return new Map();
      const summaryMap = new Map();

      Object.values(apis).forEach((apiItem) => {
        const models = apiItem?.models && typeof apiItem.models === 'object' ? apiItem.models : {};
        Object.values(models).forEach((modelItem) => {
          const details = Array.isArray(modelItem?.details) ? modelItem.details : [];
          details.forEach((detail) => {
            const sourceKey = String(detail?.source || '').trim();
            if (!sourceKey) return;

            const prev = summaryMap.get(sourceKey) || {
              totalRequests: 0,
              successRequests: 0,
              failedRequests: 0
            };
            const next = {
              totalRequests: prev.totalRequests + 1,
              successRequests: prev.successRequests + (detail?.failed === true ? 0 : 1),
              failedRequests: prev.failedRequests + (detail?.failed === true ? 1 : 0)
            };
            summaryMap.set(sourceKey, next);
          });
        });
      });

      return summaryMap;
    } catch (error) {
      console.warn('[ProviderUsage] 读取用量统计失败:', error instanceof Error ? error.message : 'unknown error');
      return new Map();
    }
  }

  function getProviderExcludedModels(entry) {
    const models = entry?.['excluded-models'] ?? entry?.excludedModels;
    return Array.isArray(models) ? models.map(item => String(item ?? '').trim()).filter(Boolean) : [];
  }

  function isProviderDisabled(entry) {
    return getProviderExcludedModels(entry).includes('*');
  }

  function getProviderBaseUrl(type, entry) {
    const configured = String(entry?.['base-url'] ?? entry?.baseUrl ?? '').trim();
    if (configured) return configured;
    if (type === 'gemini') return 'https://generativelanguage.googleapis.com';
    if (type === 'claude') return 'https://api.anthropic.com';
    return '';
  }

  function getProviderProbeUrl(type, entry) {
    const cleanBase = getProviderBaseUrl(type, entry).replace(/\/+$/g, '');
    if (!cleanBase) return '';

    if (type === 'gemini') {
      if (/\/v1beta\/models$/i.test(cleanBase)) return cleanBase;
      if (/\/v1beta$/i.test(cleanBase)) return `${cleanBase}/models`;
      return `${cleanBase}/v1beta/models`;
    }

    if (/\/v1\/models$/i.test(cleanBase)) return cleanBase;
    if (/\/v1$/i.test(cleanBase)) return `${cleanBase}/models`;
    return `${cleanBase}/v1/models`;
  }

  function extractProviderErrorText(body, fallbackText) {
    const text = String(
      body?.error?.message ??
      body?.error?.details ??
      body?.message ??
      body?.detail ??
      body?.error ??
      fallbackText ??
      ''
    ).trim();
    return text || 'unknown error';
  }

  function getProviderFailureLabel(statusCode, failureText) {
    const code = Number(statusCode || 0);
    const text = String(failureText || '').trim();
    if (isQuotaIssueText(text) || code === 429) return '额度不足或请求受限';
    if (isAuthIssueText(text) || code === 401 || code === 403) return '鉴权失败';
    if (code >= 400 && code < 600) return '接口异常';
    return '探活异常';
  }

  function isQuotaIssueText(text) {
    return /(quota|credit|balance|billing|limit|额度|余额|insufficient|exceeded|rate limit|429)/i.test(String(text || ''));
  }

  function isAuthIssueText(text) {
    return /(unauthorized|forbidden|invalid api key|invalid key|api key|authentication|auth|permission|401|403|x-api-key|x-goog-api-key)/i.test(String(text || ''));
  }

  function parseApiCallPayload(payload) {
    const upstreamStatus = Number(payload?.status_code ?? payload?.statusCode ?? 0);
    const upstreamHeaders = payload?.header ?? payload?.headers ?? {};
    const rawBody = typeof payload?.body === 'string'
      ? payload.body
      : (typeof payload?.bodyText === 'string' ? payload.bodyText : '');
    let parsedBody = null;

    if (payload?.body && typeof payload.body === 'object') {
      parsedBody = payload.body;
    } else if (rawBody) {
      try {
        parsedBody = JSON.parse(rawBody);
      } catch (_) {
        parsedBody = null;
      }
    }

    return {
      upstreamStatus,
      upstreamHeaders,
      rawBody,
      parsedBody
    };
  }

  async function callManagementApi(info, requestBody) {
    const res = await fetch(info.apiBase + '/v0/management/api-call', {
      method: 'POST',
      headers: info.headers,
      body: JSON.stringify(requestBody)
    });

    if (!res.ok) {
      return {
        ok: false,
        text: '探活异常',
        checkedAt: new Date().toLocaleString(),
        statusCode: res.status,
        className: 'cpamc-status-warn',
        detailText: `管理接口返回 HTTP ${res.status}`
      };
    }

    const payload = await res.json();
    const parsed = parseApiCallPayload(payload);
    const failureText = extractProviderErrorText(
      parsed.parsedBody,
      parsed.rawBody || `接口失败 (HTTP ${parsed.upstreamStatus || 'unknown'})`
    );

    if (parsed.upstreamStatus >= 200 && parsed.upstreamStatus < 300) {
      return {
        ok: true,
        text: '接口可用',
        checkedAt: new Date().toLocaleString(),
        statusCode: parsed.upstreamStatus,
        className: 'cpamc-status-on',
        body: parsed.parsedBody,
        rawBody: parsed.rawBody,
        headers: parsed.upstreamHeaders
      };
    }

    if (isQuotaIssueText(failureText) || parsed.upstreamStatus === 429) {
      return {
        ok: false,
        text: '额度不足或请求受限',
        checkedAt: new Date().toLocaleString(),
        statusCode: parsed.upstreamStatus,
        className: 'cpamc-status-warn',
        detailText: failureText
      };
    }

    const failureLabel = getProviderFailureLabel(parsed.upstreamStatus, failureText);
    return {
      ok: false,
      text: failureLabel,
      checkedAt: new Date().toLocaleString(),
      statusCode: parsed.upstreamStatus,
      className: failureLabel === '鉴权失败'
        ? 'cpamc-status-off'
        : 'cpamc-status-warn',
      detailText: failureText
    };
  }

  async function verifyProviderEntry(definition, entry, info, options = {}) {
    const opts = options || {};
    const configStatus = getProviderConfigStatus(definition.type, entry, {
      ignoreDisabled: opts.ignoreDisabled === true
    });
    if (configStatus.className !== 'cpamc-status-on') {
      return {
        ok: false,
        text: configStatus.text,
        checkedAt: new Date().toLocaleString(),
        className: configStatus.className
      };
    }

    const apiKey = getProviderApiKey(entry);
    const probeUrl = getProviderProbeUrl(definition.type, entry);
    const header = {
      'Content-Type': 'application/json'
    };

    if (definition.type === 'gemini') {
      header['x-goog-api-key'] = apiKey;
    } else if (definition.type === 'claude') {
      header['x-api-key'] = apiKey;
      header['anthropic-version'] = '2023-06-01';
    } else {
      header.Authorization = `Bearer ${apiKey}`;
    }

    try {
      const result = await callManagementApi(info, {
        method: 'GET',
        url: probeUrl,
        header
      });

      if (result.ok && result.body) {
        const modelCount = Array.isArray(result.body?.data)
          ? result.body.data.length
          : (Array.isArray(result.body?.models) ? result.body.models.length : null);
        if (Number.isFinite(modelCount)) {
          result.text = `接口可用 · 模型 ${modelCount}`;
        }
      }

      return result;
    } catch (error) {
      return {
        ok: false,
        text: '探活异常',
        checkedAt: new Date().toLocaleString(),
        className: 'cpamc-status-warn',
        detailText: error instanceof Error ? error.message : 'unknown error',
        error: true
      };
    }
  }

  function getProviderConfigStatus(type, entry, options = {}) {
    const opts = options || {};
    const apiKey = String(entry?.['api-key'] ?? entry?.apiKey ?? '').trim();
    const baseUrl = String(entry?.['base-url'] ?? entry?.baseUrl ?? '').trim();

    if (!opts.ignoreDisabled && isProviderDisabled(entry)) {
      return { className: 'cpamc-status-warn', text: '已停用' };
    }

    if (!apiKey) {
      return { className: 'cpamc-status-off', text: '缺少 API Key' };
    }

    if (type === 'codex' && !baseUrl) {
      return { className: 'cpamc-status-warn', text: '缺少 Base URL' };
    }

    return { className: 'cpamc-status-on', text: '已启用' };
  }

  function getProviderProbeStatus(entry, verification, groupError, healthStats) {
    if (groupError) {
      return { className: 'cpamc-status-warn', text: '接口异常' };
    }
    if (verification === null) {
      return { className: 'cpamc-status-busy', text: '检查中' };
    }
    if (verification === undefined) {
      if (healthStats?.lastProbeText) {
        return {
          className: healthStats.lastProbeClassName || (healthStats.lastProbeOk ? 'cpamc-status-on' : 'cpamc-status-warn'),
          text: healthStats.lastProbeText
        };
      }
      return { className: 'cpamc-status-idle', text: '未探活' };
    }
    return {
      className: verification.className || (verification.ok ? 'cpamc-status-on' : 'cpamc-status-off'),
      text: verification.text || (verification.ok ? '接口可用' : '检测失败')
    };
  }

  function buildProviderMeta(type, entry, verification, usageStats, groupError) {
    const apiKey = entry?.['api-key'] ?? entry?.apiKey;
    const proxyUrl = entry?.['proxy-url'] ?? entry?.proxyUrl;
    const models = entry?.models;
    const meta = [];
    const configStatus = getProviderConfigStatus(type, entry);
    const healthStats = getProviderHealthStats(type, entry);
    const probeStatus = getProviderProbeStatus(entry, verification, groupError, healthStats);
    const disableFailureThreshold = getProviderDisableFailureThreshold(usageStats);

    meta.push(`当前状态: ${configStatus.text}`);
    meta.push(`探活状态: ${probeStatus.text}`);
    meta.push(`连续失败: ${healthStats.consecutiveFailures}/${disableFailureThreshold}`);
    meta.push(`恢复计数: ${healthStats.consecutiveSuccesses}/${PROVIDER_RECOVERY_SUCCESS_THRESHOLD}`);

    meta.push(`密钥: ${maskSecret(apiKey)}`);
    meta.push(`代理: ${proxyUrl ? proxyUrl : '直连'}`);

    if (Array.isArray(models)) {
      meta.push(`模型数: ${models.length}`);
    } else if (models == null) {
      meta.push('模型数: 自动');
    }

    const excludedModels = getProviderExcludedModels(entry);
    if (excludedModels.length > 0) {
      meta.push(`排除模型: ${excludedModels.join(', ')}`);
    }

    if (usageStats && usageStats.totalRequests > 0) {
      meta.push(`成功数: ${usageStats.successRequests}`);
      meta.push(`失败: ${usageStats.failedRequests}`);
      meta.push(`成功率: ${formatPercent(usageStats.successRequests, usageStats.totalRequests)}`);
    }

    if (disableFailureThreshold > DEFAULT_PROVIDER_DISABLE_FAILURE_THRESHOLD) {
      meta.push(`停用策略: 高成功率容错 ${disableFailureThreshold} 次`);
    } else {
      meta.push(`停用策略: 连续失败 ${disableFailureThreshold} 次停用`);
    }

    meta.push(`类型: ${type}`);
    if (healthStats.lastAction === 'disabled') {
      meta.push('上次动作: 已自动停用');
    } else if (healthStats.lastAction === 'enabled') {
      meta.push('上次动作: 已自动启用');
    } else if (healthStats.lastAction === 'manual-disabled') {
      meta.push('上次动作: 已手动停用');
    } else if (healthStats.lastAction === 'manual-enabled') {
      meta.push('上次动作: 已手动启用');
    }
    const probeDetailText = String(
      verification?.detailText ||
      verification?.text ||
      healthStats.lastProbeDetailText ||
      healthStats.lastProbeText ||
      groupError ||
      ''
    ).trim();
    if (probeDetailText) {
      meta.push(`探活详情: ${probeDetailText}`);
    }
    if (verification?.checkedAt) {
      meta.push(`上次探活: ${verification.checkedAt}`);
    } else if (healthStats.lastProbeAt) {
      meta.push(`上次探活: ${healthStats.lastProbeAt}`);
    }
    return meta;
  }

  function renderProviderCard(itemObj, group, entry, index, verification, usageStats) {
    const definition = group.definition;
    const isPendingProbe = verification === null;
    const canManualCheck = !!entry && !group.error;
    const isDisabled = !!entry && isProviderDisabled(entry);
    const manualCheckLocked = !canManualCheck || isPendingProbe || isProviderAutoScanEnabled() || providerAutoScanInProgress;
    const manualToggleLocked = !entry || isPendingProbe || isProviderAutoScanEnabled() || providerAutoScanInProgress;
    const status = entry
      ? getProviderConfigStatus(definition.type, entry || {})
      : (group.error
        ? { className: 'cpamc-status-warn', text: '接口异常' }
        : { className: 'cpamc-status-idle', text: '未配置' });
    const baseUrl = entry ? getProviderBaseUrl(definition.type, entry) : '';
    const title = entry
      ? `${formatUrlHost(baseUrl) || `配置 ${index + 1}`}`
      : `${definition.label} · 接口检查`;
    const subtitle = entry
      ? (baseUrl ? baseUrl : `类型 ${definition.type}`)
      : definition.endpoint;
    const metaLines = entry
      ? buildProviderMeta(definition.type, entry, verification, usageStats, group.error)
      : [`接口: ${definition.endpoint}`];

    if (isPendingProbe) {
      metaLines.push('探活详情: 正在执行探活，请稍候...');
    }

    const metaHtml = buildMetaGridHtml(metaLines);
    const actionsHtml = canManualCheck
      ? `
        <div class="cpamc-actions">
          <button class="cpamc-btn default act-provider-check"${manualCheckLocked ? ' disabled' : ''}>${isPendingProbe ? '检查中' : '检查'}</button>
          <button class="cpamc-btn ${isDisabled ? 'success' : 'danger'} act-provider-toggle"${manualToggleLocked ? ' disabled' : ''}>${isDisabled ? '启用' : '停用'}</button>
        </div>
      `
      : '';

    itemObj.innerHTML = `
      <div class="cpamc-item-head">
        <div class="cpamc-item-title-wrap">
          <div class="cpamc-item-title">${escapeHtml(title)}</div>
          <div class="cpamc-item-subtitle">${escapeHtml(subtitle)}</div>
        </div>
        <span class="cpamc-item-status ${status.className}">${escapeHtml(status.text)}</span>
      </div>
      ${metaHtml}
      ${actionsHtml}
    `;
  }

  async function fetchProviderGroup(definition, info, configPayload) {
    const fallbackItems = extractNamedArray(configPayload, definition.configKey);

    try {
      const res = await fetch(info.apiBase + definition.endpoint, { headers: info.headers });
      if (!res.ok) {
        return {
          definition,
          items: fallbackItems,
          error: `接口异常 (HTTP ${res.status})`
        };
      }

      const payload = await res.json();
      const items = extractNamedArray(payload, definition.configKey);
      return {
        definition,
        items,
        error: null
      };
    } catch (error) {
      return {
        definition,
        items: fallbackItems,
        error: `请求异常: ${error instanceof Error ? error.message : 'unknown error'}`
      };
    }
  }

  async function saveProviderGroup(definition, items, info) {
    const res = await fetch(info.apiBase + definition.endpoint, {
      method: 'PUT',
      headers: info.headers,
      body: JSON.stringify(items)
    });

    if (!res.ok) {
      let detail = '';
      try {
        detail = await res.text();
      } catch (_) {
        detail = '';
      }
      throw new Error(detail || `保存服务商配置失败 (HTTP ${res.status})`);
    }

    try {
      return await res.json();
    } catch (_) {
      return null;
    }
  }

  async function disableProviderEntry(definition, groupItems, targetEntry, info) {
    const targetApiKey = getProviderApiKey(targetEntry);
    const targetBaseUrl = getProviderBaseUrl(definition.type, targetEntry);
    const nextItems = (Array.isArray(groupItems) ? groupItems : []).map((entry) => {
      const sameApiKey = getProviderApiKey(entry) === targetApiKey;
      const sameBaseUrl = getProviderBaseUrl(definition.type, entry) === targetBaseUrl;
      if (!sameApiKey || !sameBaseUrl) return entry;

      const excludedModels = getProviderExcludedModels(entry);
      const nextExcludedModels = excludedModels.includes('*')
        ? excludedModels
        : excludedModels.concat('*');

      return {
        ...entry,
        'excluded-models': nextExcludedModels
      };
    });

    await saveProviderGroup(definition, nextItems, info);
    return nextItems;
  }

  async function enableProviderEntry(definition, groupItems, targetEntry, info) {
    const targetApiKey = getProviderApiKey(targetEntry);
    const targetBaseUrl = getProviderBaseUrl(definition.type, targetEntry);
    const nextItems = (Array.isArray(groupItems) ? groupItems : []).map((entry) => {
      const sameApiKey = getProviderApiKey(entry) === targetApiKey;
      const sameBaseUrl = getProviderBaseUrl(definition.type, entry) === targetBaseUrl;
      if (!sameApiKey || !sameBaseUrl) return entry;

      const nextEntry = { ...entry };
      delete nextEntry['excluded-models'];
      delete nextEntry.excludedModels;
      return nextEntry;
    });

    await saveProviderGroup(definition, nextItems, info);
    return nextItems;
  }

  function findProviderEntryByIdentity(definition, groupItems, targetEntry) {
    const targetApiKey = getProviderApiKey(targetEntry);
    const targetBaseUrl = getProviderBaseUrl(definition.type, targetEntry);
    return (Array.isArray(groupItems) ? groupItems : []).find((entry) => {
      return getProviderApiKey(entry) === targetApiKey
        && getProviderBaseUrl(definition.type, entry) === targetBaseUrl;
    }) || null;
  }

  function syncProviderEntrySnapshot(targetEntry, nextEntry) {
    if (!targetEntry || !nextEntry || typeof targetEntry !== 'object' || typeof nextEntry !== 'object') return;
    Object.keys(targetEntry).forEach((key) => {
      if (!(key in nextEntry)) delete targetEntry[key];
    });
    Object.entries(nextEntry).forEach(([key, value]) => {
      targetEntry[key] = value;
    });
  }

  async function verifyAuthFile(file, info) {
    if (getAuthProvider(file) === 'codex') {
      const authIndex = String(file?.auth_index ?? file?.authIndex ?? '').trim();
      if (!authIndex) {
        return {
          ok: false,
          text: '缺少 authIndex',
          checkedAt: new Date().toLocaleString()
        };
      }

      const accountId = String(file?.id_token?.chatgpt_account_id ?? '').trim();
      const body = {
        authIndex,
        method: 'GET',
        url: CODEX_USAGE_URL,
        header: {
          Authorization: 'Bearer $TOKEN$',
          'Content-Type': 'application/json',
          'User-Agent': CODEX_USAGE_UA
        }
      };

      if (accountId) {
        body.header['Chatgpt-Account-Id'] = accountId;
      }

      try {
        const res = await fetch(info.apiBase + '/v0/management/api-call', {
          method: 'POST',
          headers: info.headers,
          body: JSON.stringify(body)
        });

        if (!res.ok) {
          return {
            ok: false,
            text: `额度接口异常 (HTTP ${res.status})`,
            checkedAt: new Date().toLocaleString(),
            statusCode: res.status
          };
        }

        const payload = await res.json();
        const upstreamStatus = Number(payload?.status_code ?? payload?.statusCode ?? 0);
        const upstreamBodyRaw = typeof payload?.body === 'string' ? payload.body : '';
        let upstreamBody = null;
        try {
          upstreamBody = upstreamBodyRaw ? JSON.parse(upstreamBodyRaw) : null;
        } catch (_) {
          upstreamBody = null;
        }

        if (upstreamStatus >= 200 && upstreamStatus < 300) {
          return {
            ok: true,
            text: '额度接口可用',
            checkedAt: new Date().toLocaleString(),
            quota: upstreamBody
          };
        }

        const message = String(
          upstreamBody?.error?.message ??
          upstreamBody?.message ??
          upstreamBodyRaw ??
          `额度接口失败 (HTTP ${upstreamStatus || 'unknown'})`
        ).trim();

        return {
          ok: false,
          text: getAuthVerificationLabel(upstreamStatus || res.status, message),
          detailText: message,
          checkedAt: new Date().toLocaleString(),
          statusCode: upstreamStatus || res.status
        };
      } catch (error) {
        return {
          ok: false,
          text: '验证异常',
          detailText: error instanceof Error ? error.message : 'unknown error',
          checkedAt: new Date().toLocaleString(),
          error: true
        };
      }
    }

    const fileId = getAuthFileId(file);
    if (!fileId) {
      return {
        ok: isAuthFileValid(file),
        text: '缺少文件标识',
        checkedAt: new Date().toLocaleString(),
        skipped: true
      };
    }

    try {
      const res = await fetch(info.apiBase + '/v0/management/auth-files/' + encodeURIComponent(fileId) + '/test', {
        headers: info.headers
      });

      let detail = '';
      try {
        const payload = await res.clone().json();
        detail = String(
          payload?.message ??
          payload?.detail ??
          payload?.error ??
          payload?.status_message ??
          payload?.statusMessage ??
          ''
        ).trim();
      } catch (_) {
        try {
          detail = (await res.text()).trim();
        } catch (_) {
          detail = '';
        }
      }

      return {
        ok: res.ok,
        text: res.ok
          ? (detail || '自动验证通过')
          : getAuthVerificationLabel(res.status, detail || `自动验证失败 (HTTP ${res.status})`),
        detailText: res.ok ? '' : (detail || `自动验证失败 (HTTP ${res.status})`),
        checkedAt: new Date().toLocaleString(),
        statusCode: res.status,
        unsupported: res.status === 404
      };
    } catch (error) {
      return {
        ok: false,
        text: '验证异常',
        detailText: error instanceof Error ? error.message : 'unknown error',
        checkedAt: new Date().toLocaleString(),
        error: true
      };
    }
  }

  async function verifyAuthFileWithTimeout(file, info, timeoutMs = AUTH_VERIFY_TIMEOUT_MS) {
    let timeoutHandle = null;
    try {
      return await Promise.race([
        verifyAuthFile(file, info),
        new Promise((resolve) => {
          timeoutHandle = setTimeout(() => {
            resolve({
              ok: false,
              text: `验证超时 (${Math.round(timeoutMs / 1000)}s)`,
              detailText: `验证请求超过 ${Math.round(timeoutMs / 1000)} 秒未返回`,
              checkedAt: new Date().toLocaleString(),
              error: true,
              timeout: true
            });
          }, timeoutMs);
        })
      ]);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }

  // =========== AI 服务商部分 (/v0/management/api-keys) ===========
  async function loadProviders(options = {}) {
    const listEl = document.getElementById('list-providers');
    const info = getReqInfo();
    const loadSeq = ++providerLoadSeq;
    const shouldProbe = options?.probe === true;
    providerListLoading = true;
    updateAutoScanControls();
    if (!info) { 
        if (loadSeq !== providerLoadSeq) return;
        listEl.innerHTML = getMissingTokenHTML();
        providerListLoading = false;
        updateAutoScanControls();
        return; 
    }
    listEl.innerHTML = shouldProbe
      ? '<div class="cpamc-loading-text">正在刷新服务商配置并执行探活...</div>'
      : '<div class="cpamc-loading-text">正在加载服务商配置...</div>';
    
    try {
      const res = await fetch(info.apiBase + '/v0/management/config', { headers: info.headers });
      
      if (!res.ok) {
        if (loadSeq !== providerLoadSeq) return;
        if (res.status === 401 || res.status === 403) {
            localStorage.removeItem('cpamc_custom_token');
            updateToolVisibility();
            listEl.innerHTML = '<div class="cpamc-loading-text" style="color:#ff4d4f;">登录凭证已过期失效 (HTTP 401)。<br/>请在原版界面重新点击左侧菜单以重新获取！</div>';
        } else {
            listEl.innerHTML = '<div class="cpamc-loading-text">获取数据失败，原系统返回 HTTP ' + res.status + '</div>';
        }
        return;
      }

      const config = await res.json();
      const usageSummaryPromise = fetchProviderUsageSummary(info);
      const providerDefinitions = getProviderDefinitions();
      const groups = await Promise.all(providerDefinitions.map(definition => fetchProviderGroup(definition, info, config)));
      const usageSummaryMap = await usageSummaryPromise;
      const visibleGroups = groups.filter(group => group.items.length > 0 || group.error);
      
      if (visibleGroups.length === 0) {
        if (loadSeq !== providerLoadSeq) return;
        listEl.innerHTML = '<div class="cpamc-loading-text">暂无 AI 服务商配置数据</div>';
        return;
      }

      listEl.innerHTML = '';
      const probeTasks = [];
      visibleGroups.forEach((group) => {
        const entries = group.items.length > 0 ? group.items : [null];
        const groupSection = document.createElement('div');
        groupSection.className = 'cpamc-group-section';
        const groupTitle = document.createElement('div');
        const total = group.items.length || 1;
        groupTitle.className = 'cpamc-group-title';
        groupTitle.textContent = `${group.definition.label} · ${total}`;
        groupSection.appendChild(groupTitle);
        listEl.appendChild(groupSection);

        const itemNodes = entries.map((entry, index) => {
          const itemObj = document.createElement('div');
          itemObj.className = 'cpamc-item';
          const usageStats = entry ? usageSummaryMap.get(getProviderApiKey(entry)) : null;
          let currentEntry = entry;
          let currentVerification = undefined;
          const renderAndBind = (nextVerification) => {
            currentVerification = nextVerification;
            renderProviderCard(
              itemObj,
              group,
              currentEntry,
              index,
              nextVerification,
              usageStats
            );
            const manualCheckBtn = itemObj.querySelector('.act-provider-check');
            const manualToggleBtn = itemObj.querySelector('.act-provider-toggle');
            if (manualCheckBtn && currentEntry && !group.error) {
              manualCheckBtn.onclick = async () => {
              if (providerListLoading || isProviderAutoScanEnabled() || providerAutoScanInProgress) return;
              renderAndBind(null);
              try {
                const manualVerification = await verifyProviderEntry(group.definition, currentEntry, info, {
                  ignoreDisabled: true
                });
                storeProviderProbeSnapshot(group.definition.type, currentEntry, manualVerification);
                if (loadSeq !== providerLoadSeq) return;
                renderAndBind(manualVerification);
              } catch (error) {
                const failedVerification = {
                  ok: false,
                  text: '探活异常',
                  checkedAt: new Date().toLocaleString(),
                  className: 'cpamc-status-warn',
                  detailText: error instanceof Error ? error.message : 'unknown error',
                  error: true
                };
                storeProviderProbeSnapshot(group.definition.type, currentEntry, failedVerification);
                if (loadSeq !== providerLoadSeq) return;
                renderAndBind(failedVerification);
              }
              };
            }
            if (manualToggleBtn && currentEntry && !group.error) {
              manualToggleBtn.onclick = async () => {
                if (isProviderAutoScanEnabled() || providerAutoScanInProgress) return;
                const nextDisabled = !isProviderDisabled(currentEntry);
                manualCheckBtn && (manualCheckBtn.disabled = true);
                manualToggleBtn.disabled = true;
                manualToggleBtn.textContent = nextDisabled ? '停用中' : '启用中';
                try {
                  const nextItems = nextDisabled
                    ? await disableProviderEntry(group.definition, group.items || [], currentEntry, info)
                    : await enableProviderEntry(group.definition, group.items || [], currentEntry, info);
                  group.items = nextItems;
                  const nextEntry = findProviderEntryByIdentity(group.definition, nextItems, currentEntry);
                  if (nextEntry) syncProviderEntrySnapshot(currentEntry, nextEntry);
                  setProviderHealthStats(group.definition.type, currentEntry, {
                    ...getProviderHealthStats(group.definition.type, currentEntry),
                    consecutiveFailures: 0,
                    consecutiveSuccesses: 0,
                    lastAction: nextDisabled ? 'manual-disabled' : 'manual-enabled'
                  });
                  if (loadSeq !== providerLoadSeq) return;
                  renderAndBind(currentVerification);
                  loadProviders({ probe: false, source: 'manual-toggle' });
                } catch (error) {
                  if (loadSeq !== providerLoadSeq) return;
                  renderAndBind(currentVerification);
                  await showMessageDialog({
                    title: nextDisabled ? '手动停用失败' : '手动启用失败',
                    message: error instanceof Error ? error.message : 'unknown error'
                  });
                }
              };
            }
          };
          renderAndBind(
            group.error
              ? { ok: false, text: '接口异常', className: 'cpamc-status-warn', detailText: group.error }
              : (shouldProbe ? null : undefined)
          );
          groupSection.appendChild(itemObj);
          return { itemObj, renderAndBind };
        });

        if (group.error || !shouldProbe) return;

        const probeTask = runWithConcurrency(entries, getProviderAutoScanConcurrency(), async (entry, index) => {
          if (!entry) return null;
          const verification = await verifyProviderEntry(group.definition, entry, info, {
            ignoreDisabled: isProviderDisabled(entry)
          });
          if (loadSeq !== providerLoadSeq) return verification;
          storeProviderProbeSnapshot(group.definition.type, entry, verification);
          itemNodes[index].renderAndBind(verification);
          return verification;
        }).catch(error => {
          if (loadSeq !== providerLoadSeq) return;
          const itemObj = document.createElement('div');
          itemObj.className = 'cpamc-item';
          itemObj.innerHTML = `
            <div class="cpamc-item-head">
              <div class="cpamc-item-title">${escapeHtml(group.definition.label)} · 探活失败</div>
              <span class="cpamc-item-status cpamc-status-warn">接口异常</span>
            </div>
            ${buildMetaGridHtml([`探活详情: ${error instanceof Error ? error.message : 'unknown error'}`])}
          `;
          groupSection.appendChild(itemObj);
        });

        probeTasks.push(probeTask);
      });

      await Promise.allSettled(probeTasks);
      if (loadSeq !== providerLoadSeq) return;

    } catch (err) {
      console.error(err);
      if (loadSeq !== providerLoadSeq) return;
      listEl.innerHTML = '<div class="cpamc-loading-text">网络发生异常，无法拉取数据。</div>';
    } finally {
      if (loadSeq === providerLoadSeq) {
        providerListLoading = false;
        updateAutoScanControls();
      }
    }
  }

  // =========== 认证文件部分 (/v0/management/auth-files) ===========
  async function loadAuthFiles(options = {}) {
    const listEl = document.getElementById('list-auth');
    const info = getReqInfo();
    const loadSeq = ++authLoadSeq;
    const shouldVerify = options?.verify === true;
    const shouldMarkChecking = options?.checking === true;
    authListLoading = true;
    updateAutoScanControls();
    if (!info) { 
        if (loadSeq !== authLoadSeq) return;
        listEl.innerHTML = getMissingTokenHTML();
        authListLoading = false;
        updateAutoScanControls();
        return; 
    }
    listEl.innerHTML = shouldVerify
      ? '<div class="cpamc-loading-text">正在加载认证文件并自动验证状态...</div>'
      : '<div class="cpamc-loading-text">正在加载认证文件配置...</div>';
    
    try {
      const res = await fetch(info.apiBase + '/v0/management/auth-files', { headers: info.headers });
      if (loadSeq !== authLoadSeq) return;
      if (!res.ok) {
        listEl.innerHTML = '<div class="cpamc-loading-text">获取数据失败，返回异常响应 (HTTP ' + res.status + ')</div>';
        return;
      }

      const data = await res.json();
      if (loadSeq !== authLoadSeq) return;
      const files = extractList(data);
      
      if (files.length === 0) {
        listEl.innerHTML = '<div class="cpamc-loading-text">暂无认证文件配置</div>';
        return;
      }

      const verificationList = shouldVerify
        ? await runWithConcurrency(
            files,
            getAutoScanConcurrency(),
            async (file) => verifyAuthFileWithTimeout(file, info)
          )
        : files.map(() => null);
      if (loadSeq !== authLoadSeq) return;
      const groupedFiles = new Map();
      files.forEach((file, index) => {
        const provider = getAuthProvider(file);
        if (!groupedFiles.has(provider)) groupedFiles.set(provider, []);
        groupedFiles.get(provider).push({ file, verification: verificationList[index] });
      });
      
      listEl.innerHTML = '';
      groupedFiles.forEach((entries, provider) => {
        const groupSection = document.createElement('div');
        groupSection.className = 'cpamc-group-section';
        const groupTitle = document.createElement('div');
        groupTitle.className = 'cpamc-group-title';
        groupTitle.textContent = `${formatProviderLabel(provider)} · ${entries.length}`;
        groupSection.appendChild(groupTitle);
        listEl.appendChild(groupSection);

        entries.forEach(({ file: f, verification }) => {
        const itemObj = document.createElement('div');
        itemObj.className = 'cpamc-item';
        const statusInfo = getAuthFileStatusInfo(f, isAuthFileValid(f));
        const isValid = verification ? verification.ok : isAuthFileValid(f);
        const isChecking = shouldMarkChecking && !verification;
        const isActionLocked = isChecking || isAutoScanEnabled() || autoScanInProgress;
        const statusClass = isChecking
          ? 'cpamc-status-busy'
          : verification?.unsupported
          ? 'cpamc-status-warn'
          : (isValid ? 'cpamc-status-on' : 'cpamc-status-off');
        const statusText = isChecking
          ? '检查中'
          : (verification?.text || statusInfo.text);
        const fileId = getAuthFileId(f);
        const metaLines = buildAuthFileMeta(f);
        const authSubtitleParts = [
          formatProviderLabel(getAuthProvider(f)),
          f?.account || f?.email || fileId
        ].filter(Boolean);
        if (isChecking) {
          metaLines.push('验证详情: 正在按当前巡检队列检查...');
        }
        if (!verification?.detailText && statusInfo.detailText && statusInfo.detailText !== statusInfo.text) {
          metaLines.push(`验证详情: ${statusInfo.detailText}`);
        }
        if (verification?.detailText && verification.detailText !== verification.text) {
          metaLines.push(`验证详情: ${verification.detailText}`);
        }
        if (verification?.checkedAt) {
          metaLines.push(`验证: ${verification.checkedAt}`);
        }
        const metaHtml = buildMetaGridHtml(metaLines);

        itemObj.innerHTML = `
          <div class="cpamc-item-head">
            <div class="cpamc-item-title-wrap">
              <div class="cpamc-item-title">${escapeHtml(getAuthFileDisplayName(f))}</div>
              <div class="cpamc-item-subtitle">${escapeHtml(authSubtitleParts.join(' · ') || '认证文件')}</div>
            </div>
            <span class="cpamc-item-status ${statusClass}">${escapeHtml(statusText)}</span>
          </div>
          ${metaHtml}
          <div class="cpamc-actions">
            <button class="cpamc-btn default act-test"${isActionLocked ? ' disabled' : ''}>验证使用</button>
            <button class="cpamc-btn danger act-del"${isActionLocked ? ' disabled' : ''}>清理删除</button>
          </div>
        `;
        
        itemObj.querySelector('.act-test').onclick = async () => {
          if (!fileId) {
            await showMessageDialog({
              title: '验证提示',
              message: '缺少认证文件标识，无法验证。'
            });
            return;
          }
          try {
            const result = await verifyAuthFileWithTimeout(f, info);
            if (result.unsupported) {
              await showMessageDialog({
                title: '验证提示',
                message: '当前服务端未提供认证文件验证接口。\n\n已为该文件标记“验证接口不存在 (HTTP 404)”。'
              });
            } else if (result.ok) {
              await showMessageDialog({
                title: '验证通过',
                message: result.text
              });
            } else {
              await showMessageDialog({
                title: '验证未通过',
                message: result.text
              });
            }
            loadAuthFiles({ verify: false, source: 'item-verify' }); 
          } catch(e) {
            await showMessageDialog({
              title: '验证异常',
              message: '请求验证时出现异常。'
            });
          }
        };

        itemObj.querySelector('.act-del').onclick = async () => {
          const deleteName = getAuthFileDeleteName(f);
          if (!deleteName) {
            await showMessageDialog({
              title: '删除提示',
              message: '缺少认证文件名称，无法删除。'
            });
            return;
          }

          const confirmed = await showConfirmDialog({
            title: '删除认证文件',
            message: `确定要删除文件\n"${deleteName}" ?`
          });

          if (!confirmed) return;

          try {
            const deleteRes = await fetch(
              info.apiBase + '/v0/management/auth-files?name=' + encodeURIComponent(deleteName),
              { method: 'DELETE', headers: info.headers }
            );
            if (!deleteRes.ok) {
              throw new Error(`删除失败 (HTTP ${deleteRes.status})`);
            }
            loadAuthFiles({ verify: false, source: 'item-delete' });
          } catch (error) {
            await showMessageDialog({
              title: '删除失败',
              message: error instanceof Error ? error.message : 'unknown error'
            });
          }
        };
        
        groupSection.appendChild(itemObj);
        });
      });

    } catch (err) {
      console.error(err);
      if (loadSeq !== authLoadSeq) return;
      listEl.innerHTML = '<div class="cpamc-loading-text">网络请求发生异常，无法拉取数据。</div>';
    } finally {
      if (loadSeq === authLoadSeq) {
        authListLoading = false;
        updateAutoScanControls();
      }
    }
  }

  async function runWithConcurrency(items, concurrency, worker) {
    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) return [];
    const limit = clampInt(concurrency, MIN_AUTO_SCAN_CONCURRENCY, MAX_AUTO_SCAN_CONCURRENCY, DEFAULT_AUTO_SCAN_CONCURRENCY);
    const results = new Array(list.length);
    let currentIndex = 0;

    async function runner() {
      while (currentIndex < list.length) {
        const index = currentIndex++;
        results[index] = await worker(list[index], index);
      }
    }

    await Promise.all(Array.from({ length: Math.min(limit, list.length) }, () => runner()));
    return results;
  }

  // =========== 后台自动定期巡检逻辑 ===========
  async function backgroundProviderCheck(options = {}) {
    const sessionId = typeof options.sessionId === 'number' ? options.sessionId : providerAutoScanSessionId;
    if (!isProviderAutoScanSessionActive(sessionId)) return;
    const info = getReqInfo();
    if (!info) return; // 没有捕获到 token 时后台静默中止
    
    try {
      const provRes = await fetch(info.apiBase + '/v0/management/config', { headers: info.headers });
      if (!isProviderAutoScanSessionActive(sessionId)) return;
      if (!provRes.ok) {
        console.warn('[ProviderAutoCheck后台监测] 服务商配置读取失败:', provRes.status);
        return;
      }

        const config = await provRes.json();
        if (!isProviderAutoScanSessionActive(sessionId)) return;
        const providerDefinitions = getProviderDefinitions();

        const usageSummaryMap = await fetchProviderUsageSummary(info);
        const groups = await Promise.all(providerDefinitions.map(definition => fetchProviderGroup(definition, info, config)));
        if (!isProviderAutoScanSessionActive(sessionId)) return;
        const providerEntries = groups.flatMap(group => {
          if (group.error) {
            console.warn('[ProviderAutoCheck后台监测] 服务商配置接口异常:', group.definition.label, group.error);
            return [];
          }
          return (group.items || []).map((entry, index) => ({ group, entry, index }));
        });

        await runWithConcurrency(providerEntries, getProviderAutoScanConcurrency(), async ({ group, entry, index }) => {
          if (!isProviderAutoScanSessionActive(sessionId)) return;
          const disabled = isProviderDisabled(entry);
          const autoManage = isProviderHealthManagedEnabled();
          const usageStats = usageSummaryMap.get(getProviderApiKey(entry));
          const verification = await verifyProviderEntry(group.definition, entry || {}, info, {
            ignoreDisabled: disabled
          });
          if (!isProviderAutoScanSessionActive(sessionId)) return;
          const healthStats = updateProviderHealthStats(group.definition.type, entry || {}, verification, usageStats, {
            disabled
          });
          if (verification.ok) {
            if (disabled && autoManage && healthStats.consecutiveSuccesses >= PROVIDER_RECOVERY_SUCCESS_THRESHOLD) {
              try {
                if (!isProviderAutoScanSessionActive(sessionId)) return;
                await enableProviderEntry(group.definition, group.items || [], entry, info);
                setProviderHealthStats(group.definition.type, entry || {}, {
                  ...healthStats,
                  consecutiveFailures: 0,
                  consecutiveSuccesses: 0,
                  lastAction: 'enabled'
                });
                console.log('[ProviderAutoCheck后台监测] 服务商已自动启用:', `${group.definition.label} #${index + 1}`, getProviderBaseUrl(group.definition.type, entry) || getProviderApiKey(entry));
              } catch (error) {
                console.warn('[ProviderAutoCheck后台监测] 服务商自动启用失败:', `${group.definition.label} #${index + 1}`, error instanceof Error ? error.message : 'unknown error');
              }
            }
            return;
          }

          if (!verification.ok) {
            console.warn('[ProviderAutoCheck后台监测] 服务商探活失败:', `${group.definition.label} #${index + 1}`, verification.text, verification.detailText || '');
            if (autoManage && !disabled && healthStats.consecutiveFailures >= getProviderDisableFailureThreshold(usageStats)) {
              try {
                if (!isProviderAutoScanSessionActive(sessionId)) return;
                await disableProviderEntry(group.definition, group.items || [], entry, info);
                setProviderHealthStats(group.definition.type, entry || {}, {
                  ...healthStats,
                  consecutiveSuccesses: 0,
                  lastAction: 'disabled'
                });
                console.log('[ProviderAutoCheck后台监测] 服务商已自动停用:', `${group.definition.label} #${index + 1}`, getProviderBaseUrl(group.definition.type, entry) || getProviderApiKey(entry));
              } catch (error) {
                console.warn('[ProviderAutoCheck后台监测] 服务商自动停用失败:', `${group.definition.label} #${index + 1}`, error instanceof Error ? error.message : 'unknown error');
              }
            }
          }
        });
    } catch(err) {
      console.error('[ProviderAutoCheck背景运行错误]', err);
    }
  }

  async function backgroundAuthCheck(options = {}) {
    const sessionId = typeof options.sessionId === 'number' ? options.sessionId : autoScanSessionId;
    const allowDelete = options.allowDelete === true;
    if (!isAuthAutoScanSessionActive(sessionId)) return;
    const info = getReqInfo();
    if (!info) return; // 没有捕获到 token 时后台静默中止

    try {
      const authRes = await fetch(info.apiBase + '/v0/management/auth-files', { headers: info.headers });
      if (!isAuthAutoScanSessionActive(sessionId)) return;
      if (authRes.ok) {
        let items = await authRes.json();
        items = extractList(items);
        const concurrency = getAutoScanConcurrency();
        await runWithConcurrency(items, concurrency, async (f) => {
          if (!isAuthAutoScanSessionActive(sessionId)) return;
          const verifyResult = await verifyAuthFileWithTimeout(f, info);
          if (!isAuthAutoScanSessionActive(sessionId)) return;
          const deleteName = getAuthFileDeleteName(f);
          if (!deleteName) return;

          if (verifyResult.unsupported) {
            console.log('[AutoCheck后台监测] 当前版本未提供认证文件验证接口，跳过自动清理:', f.name);
            return;
          }

          if (!verifyResult.ok) {
            if (!allowDelete) {
              console.warn('[AutoCheck后台监测] 认证文件检测失败，已标记待处理:', f.name, verifyResult.text);
              return;
            }

            console.log('[AutoCheck后台监测] 认证文件无效，自动清理:', f.name, verifyResult.text);
            if (!isAuthAutoScanSessionActive(sessionId)) return;
            await fetch(
              info.apiBase + '/v0/management/auth-files?name=' + encodeURIComponent(deleteName),
              { method: 'DELETE', headers: info.headers }
            );
          }
        });
      }
    } catch(err) {
      console.error('[AuthAutoCheck背景运行错误]', err);
    }
  }
})();
