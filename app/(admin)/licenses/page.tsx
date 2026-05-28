"use client";

import { useEffect, useState } from "react";
import {
  fetchLicenseActivations,
  fetchLicenseExtensions,
  fetchLicenseKeys,
  reactivateLicenseKey,
  resetLicenseActivation,
  resetLicenseKeyActivation,
  revokeLicenseKey,
  saveLicenseExtension,
  saveLicenseKey
} from "@/lib/licenseAdminClient";
import type {
  LicenseActivationAdminStatus,
  LicenseActivationRecord,
  LicenseExtensionRecord,
  LicenseKeyAdminStatus,
  LicenseKeyDeviceLimitMode,
  LicenseKeyRecord
} from "@/lib/licenseTypes";
import { ConfirmDialog, RowActionMenu } from "@/components/AdminUi";

type LicenseTab = "extensions" | "keys" | "activations";

type LicenseConfirmAction =
  | { type: "delete-extension"; extension: LicenseExtensionRecord }
  | { type: "revoke-key"; key: LicenseKeyRecord }
  | { type: "reset-key"; key: LicenseKeyRecord }
  | { type: "reset-activation"; activation: LicenseActivationRecord }
  | null;

const createDefaultExpiryInput = () => {
  const date = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};

const toDateTimeLocalValue = (isoString: string) => {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return createDefaultExpiryInput();
  }
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};

const formatDateTime = (isoString: string | null | undefined) => {
  if (!isoString) return "-";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
};

const getKeyStatusLabel = (status: LicenseKeyAdminStatus) => {
  if (status === "active") return "Đang hoạt động";
  if (status === "expired") return "Hết hạn";
  return "Đã thu hồi";
};

const getActivationStatusLabel = (status: LicenseActivationAdminStatus) => {
  if (status === "active") return "Đang bind";
  if (status === "expired") return "Key hết hạn";
  if (status === "revoked") return "Key đã thu hồi";
  if (status === "extension_disabled") return "Extension bị tắt";
  return "Đã reset";
};

const getDeviceLimitModeLabel = (mode: LicenseKeyDeviceLimitMode) =>
  mode === "unlimited_devices" ? "Không giới hạn" : "1 thiết bị";

const summarizeActiveFingerprints = (key: LicenseKeyRecord) => {
  if (!key.activeActivations.length) {
    return "-";
  }

  const preview = key.activeActivations
    .slice(0, 2)
    .map((activation) => activation.fingerprint)
    .join(", ");

  if (key.activeActivations.length <= 2) {
    return preview;
  }

  return `${preview} +${key.activeActivations.length - 2} thiết bị`;
};

export default function LicensesPage() {
  const [tab, setTab] = useState<LicenseTab>("extensions");
  const [extensions, setExtensions] = useState<LicenseExtensionRecord[]>([]);
  const [keys, setKeys] = useState<LicenseKeyRecord[]>([]);
  const [activations, setActivations] = useState<LicenseActivationRecord[]>([]);
  const [loadedTabs, setLoadedTabs] = useState<Record<LicenseTab, boolean>>({
    extensions: false,
    keys: false,
    activations: false
  });
  const [loadingExtensions, setLoadingExtensions] = useState(false);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [loadingActivations, setLoadingActivations] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<LicenseConfirmAction>(null);

  const [extensionCode, setExtensionCode] = useState("");
  const [extensionName, setExtensionName] = useState("");
  const [extensionDescription, setExtensionDescription] = useState("");
  const [extensionIsActive, setExtensionIsActive] = useState(true);
  const [editingExtension, setEditingExtension] = useState<LicenseExtensionRecord | null>(null);
  const [editExtensionName, setEditExtensionName] = useState("");
  const [editExtensionDescription, setEditExtensionDescription] = useState("");
  const [editExtensionIsActive, setEditExtensionIsActive] = useState(true);

  const [keyExtensionId, setKeyExtensionId] = useState("");
  const [keyExpiresAt, setKeyExpiresAt] = useState(createDefaultExpiryInput());
  const [keyNote, setKeyNote] = useState("");
  const [keyDeviceLimitMode, setKeyDeviceLimitMode] = useState<LicenseKeyDeviceLimitMode>("single_device");
  const [editingKey, setEditingKey] = useState<LicenseKeyRecord | null>(null);
  const [editKeyExpiresAt, setEditKeyExpiresAt] = useState(createDefaultExpiryInput());
  const [editKeyNote, setEditKeyNote] = useState("");
  const [editKeyDeviceLimitMode, setEditKeyDeviceLimitMode] = useState<LicenseKeyDeviceLimitMode>("single_device");
  const [latestCreatedKey, setLatestCreatedKey] = useState<{
    rawKey: string;
    maskedKey: string;
    extensionCode: string;
    expiresAt: string;
  } | null>(null);

  const [keyFilterExtensionId, setKeyFilterExtensionId] = useState("all");
  const [keyFilterStatus, setKeyFilterStatus] = useState<LicenseKeyAdminStatus | "all">("all");
  const [activationFilterExtensionId, setActivationFilterExtensionId] = useState("all");
  const [activationActiveOnly, setActivationActiveOnly] = useState(false);

  const clearFeedback = () => {
    setStatusMessage(null);
    setErrorMessage(null);
  };

  const loadExtensions = async () => {
    setLoadingExtensions(true);
    try {
      const data = await fetchLicenseExtensions();
      setExtensions(data);
      setLoadedTabs((current) => ({ ...current, extensions: true }));
    } finally {
      setLoadingExtensions(false);
    }
  };

  const loadKeys = async () => {
    setLoadingKeys(true);
    try {
      const data = await fetchLicenseKeys({
        extensionId: keyFilterExtensionId === "all" ? null : Number(keyFilterExtensionId),
        status: keyFilterStatus
      });
      setKeys(data);
      setLoadedTabs((current) => ({ ...current, keys: true }));
    } finally {
      setLoadingKeys(false);
    }
  };

  const loadActivations = async () => {
    setLoadingActivations(true);
    try {
      const data = await fetchLicenseActivations({
        extensionId: activationFilterExtensionId === "all" ? null : Number(activationFilterExtensionId),
        activeOnly: activationActiveOnly
      });
      setActivations(data);
      setLoadedTabs((current) => ({ ...current, activations: true }));
    } finally {
      setLoadingActivations(false);
    }
  };

  const refreshLicenseData = async ({
    extensions: includeExtensions = true,
    keys: includeKeys = false,
    activations: includeActivations = false
  }: {
    extensions?: boolean;
    keys?: boolean;
    activations?: boolean;
  } = {}) => {
    const tasks: Array<Promise<void>> = [];
    if (includeExtensions) tasks.push(loadExtensions());
    if (includeKeys) tasks.push(loadKeys());
    if (includeActivations) tasks.push(loadActivations());
    await Promise.all(tasks);
  };

  const refreshCurrentTab = async () => {
    await refreshLicenseData({
      extensions: true,
      keys: tab === "keys",
      activations: tab === "activations"
    });
  };

  useEffect(() => {
    loadExtensions().catch((error) => {
      setErrorMessage(error instanceof Error ? error.message : "Không thể tải dữ liệu license.");
    });
  }, []);

  useEffect(() => {
    if (tab !== "keys") return;
    loadKeys().catch((error) => {
      setErrorMessage(error instanceof Error ? error.message : "Không thể tải danh sách key.");
    });
  }, [tab, keyFilterExtensionId, keyFilterStatus]);

  useEffect(() => {
    if (tab !== "activations") return;
    loadActivations().catch((error) => {
      setErrorMessage(error instanceof Error ? error.message : "Không thể tải activation.");
    });
  }, [tab, activationFilterExtensionId, activationActiveOnly]);

  const handleCreateExtension = async (event: React.FormEvent) => {
    event.preventDefault();
    clearFeedback();
    setBusyAction("create-extension");
    try {
      await saveLicenseExtension({
        code: extensionCode,
        name: extensionName,
        description: extensionDescription,
        isActive: extensionIsActive
      });
      setExtensionCode("");
      setExtensionName("");
      setExtensionDescription("");
      setExtensionIsActive(true);
      setStatusMessage("Đã tạo extension mới.");
      await loadExtensions();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Không thể tạo extension.");
    } finally {
      setBusyAction(null);
    }
  };

  const openEditExtension = (extension: LicenseExtensionRecord) => {
    setEditingExtension(extension);
    setEditExtensionName(extension.name);
    setEditExtensionDescription(extension.description || "");
    setEditExtensionIsActive(extension.isActive);
  };

  const handleUpdateExtension = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingExtension) return;
    clearFeedback();
    setBusyAction(`save-extension-${editingExtension.id}`);
    try {
      await saveLicenseExtension({
        id: editingExtension.id,
        name: editExtensionName,
        description: editExtensionDescription,
        isActive: editExtensionIsActive
      });
      setEditingExtension(null);
      setStatusMessage("Đã cập nhật extension.");
      await refreshLicenseData({
        extensions: true,
        keys: loadedTabs.keys,
        activations: loadedTabs.activations
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Không thể cập nhật extension.");
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeleteExtension = async (extension: LicenseExtensionRecord) => {
    clearFeedback();
    setBusyAction(`delete-extension-${extension.id}`);
    try {
      await saveLicenseExtension({ id: extension.id, action: "delete" });
      setStatusMessage("Đã xóa extension.");
      await refreshLicenseData({
        extensions: true,
        keys: loadedTabs.keys,
        activations: loadedTabs.activations
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Không thể xóa extension.");
    } finally {
      setBusyAction(null);
    }
  };

  const handleCreateKey = async (event: React.FormEvent) => {
    event.preventDefault();
    clearFeedback();
    setBusyAction("create-key");
    try {
      const response = await saveLicenseKey({
        extensionId: Number(keyExtensionId),
        expiresAt: new Date(keyExpiresAt).toISOString(),
        note: keyNote,
        deviceLimitMode: keyDeviceLimitMode
      });
      const extension = extensions.find((item) => item.id === Number(keyExtensionId));
      setLatestCreatedKey(
        response.rawKey
          ? {
              rawKey: response.rawKey,
              maskedKey: response.maskedKey || "",
              extensionCode: extension?.code || "",
              expiresAt: new Date(keyExpiresAt).toISOString()
            }
          : null
      );
      setKeyNote("");
      setKeyExpiresAt(createDefaultExpiryInput());
      setKeyDeviceLimitMode("single_device");
      setStatusMessage("Đã tạo license key mới. Hãy lưu raw key ngay bây giờ.");
      await refreshLicenseData({
        extensions: true,
        keys: true,
        activations: loadedTabs.activations
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Không thể tạo license key.");
    } finally {
      setBusyAction(null);
    }
  };

  const openEditKey = (key: LicenseKeyRecord) => {
    setEditingKey(key);
    setEditKeyExpiresAt(toDateTimeLocalValue(key.expiresAt));
    setEditKeyNote(key.note || "");
    setEditKeyDeviceLimitMode(key.deviceLimitMode);
  };

  const handleUpdateKey = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingKey) return;
    clearFeedback();
    setBusyAction(`save-key-${editingKey.id}`);
    try {
      const response = await saveLicenseKey({
        id: editingKey.id,
        expiresAt: new Date(editKeyExpiresAt).toISOString(),
        note: editKeyNote,
        deviceLimitMode: editKeyDeviceLimitMode
      });
      setEditingKey(null);
      setStatusMessage(
        response.prunedActivationCount
          ? `Đã cập nhật license key và reset ${response.prunedActivationCount} bind dư để áp dụng chế độ 1 thiết bị.`
          : "Đã cập nhật license key."
      );
      await refreshLicenseData({
        extensions: true,
        keys: true,
        activations: loadedTabs.activations
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Không thể cập nhật license key.");
    } finally {
      setBusyAction(null);
    }
  };

  const handleRevokeKey = async (key: LicenseKeyRecord) => {
    clearFeedback();
    setBusyAction(`revoke-key-${key.id}`);
    try {
      await revokeLicenseKey(key.id);
      setStatusMessage("Đã thu hồi license key.");
      await refreshLicenseData({
        extensions: true,
        keys: true,
        activations: loadedTabs.activations
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Không thể thu hồi key.");
    } finally {
      setBusyAction(null);
    }
  };

  const handleReactivateKey = async (key: LicenseKeyRecord) => {
    clearFeedback();
    setBusyAction(`reactivate-key-${key.id}`);
    try {
      await reactivateLicenseKey(key.id);
      setStatusMessage("Đã kích hoạt lại license key.");
      await refreshLicenseData({
        extensions: true,
        keys: true,
        activations: loadedTabs.activations
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Không thể kích hoạt lại key.");
    } finally {
      setBusyAction(null);
    }
  };

  const handleResetAllActivations = async (keyId: number) => {
    clearFeedback();
    setBusyAction(`reset-key-${keyId}`);
    try {
      await resetLicenseKeyActivation(keyId);
      setStatusMessage("Đã reset tất cả bind hiện tại của key.");
      await refreshLicenseData({
        extensions: true,
        keys: loadedTabs.keys,
        activations: true
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Không thể reset activation.");
    } finally {
      setBusyAction(null);
    }
  };

  const handleResetSingleActivation = async (activation: LicenseActivationRecord) => {
    clearFeedback();
    setBusyAction(`reset-activation-${activation.id}`);
    try {
      await resetLicenseActivation(activation.id);
      setStatusMessage("Đã reset activation được chọn.");
      await refreshLicenseData({
        extensions: true,
        keys: loadedTabs.keys,
        activations: true
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Không thể reset activation này.");
    } finally {
      setBusyAction(null);
    }
  };

  const copyLatestKey = async () => {
    if (!latestCreatedKey?.rawKey) return;
    try {
      await navigator.clipboard.writeText(latestCreatedKey.rawKey);
      setStatusMessage("Đã copy raw key.");
    } catch {
      setErrorMessage("Không thể copy raw key trên trình duyệt này.");
    }
  };

  const extensionOptions = extensions.slice().sort((a, b) => a.code.localeCompare(b.code));
  const pendingConfirmBusy =
    pendingConfirm?.type === "delete-extension"
      ? busyAction === `delete-extension-${pendingConfirm.extension.id}`
      : pendingConfirm?.type === "revoke-key"
        ? busyAction === `revoke-key-${pendingConfirm.key.id}`
        : pendingConfirm?.type === "reset-key"
          ? busyAction === `reset-key-${pendingConfirm.key.id}`
          : pendingConfirm?.type === "reset-activation"
            ? busyAction === `reset-activation-${pendingConfirm.activation.id}`
            : false;

  const confirmPendingLicenseAction = async () => {
    if (!pendingConfirm) return;
    const action = pendingConfirm;
    if (action.type === "delete-extension") {
      await handleDeleteExtension(action.extension);
    } else if (action.type === "revoke-key") {
      await handleRevokeKey(action.key);
    } else if (action.type === "reset-key") {
      await handleResetAllActivations(action.key.id);
    } else {
      await handleResetSingleActivation(action.activation);
    }
    setPendingConfirm(null);
  };

  const confirmTitle =
    pendingConfirm?.type === "delete-extension"
      ? "Xóa extension?"
      : pendingConfirm?.type === "revoke-key"
        ? "Thu hồi license key?"
        : pendingConfirm?.type === "reset-key"
          ? "Reset tất cả bind?"
          : "Reset bind này?";

  const confirmDescription = pendingConfirm ? (
    <>
      {pendingConfirm.type === "delete-extension" && (
        <>
          Extension <strong>{pendingConfirm.extension.code}</strong> sẽ bị xóa khỏi danh sách quản trị.
        </>
      )}
      {pendingConfirm.type === "revoke-key" && (
        <>
          Key <strong>{pendingConfirm.key.maskedKey}</strong> sẽ bị thu hồi và không còn xác thực được.
        </>
      )}
      {pendingConfirm.type === "reset-key" && (
        <>
          Tất cả bind hiện tại của key <strong>{pendingConfirm.key.maskedKey}</strong> sẽ bị reset.
        </>
      )}
      {pendingConfirm.type === "reset-activation" && (
        <>
          Bind fingerprint <strong>{pendingConfirm.activation.fingerprint}</strong> sẽ bị reset.
        </>
      )}
    </>
  ) : null;

  return (
    <div className="grid license-layout" style={{ gap: 24 }}>
      <div className="topbar">
        <div>
          <h1 className="page-title">Licenses</h1>
          <p className="muted">Quản lý extension, license key, fingerprint bind và trạng thái xác thực.</p>
        </div>
        <div className="table-actions">
          <button
            className="button secondary"
            type="button"
            onClick={() => {
              clearFeedback();
              refreshCurrentTab().catch((error) => {
                setErrorMessage(error instanceof Error ? error.message : "Không thể làm mới dữ liệu.");
              });
            }}
          >
            Làm mới tab hiện tại
          </button>
          <div className="badge">Supabase + Dashboard</div>
        </div>
      </div>

      <div className="grid stats license-summary-grid">
        <div className="card">
          <p className="muted">Extensions</p>
          <h2>{extensions.length}</h2>
        </div>
        <div className="card">
          <p className="muted">Keys</p>
          <h2>{loadedTabs.keys ? keys.length : "-"}</h2>
        </div>
        <div className="card">
          <p className="muted">Activations</p>
          <h2>{loadedTabs.activations ? activations.length : "-"}</h2>
        </div>
        <div className="card">
          <p className="muted">Đang bind</p>
          <h2>{loadedTabs.activations ? activations.filter((item) => item.status === "active").length : "-"}</h2>
        </div>
      </div>

      {(statusMessage || errorMessage) && (
        <div className={`card license-message ${errorMessage ? "is-error" : "is-success"}`}>
          <div className="license-message-title">{errorMessage ? "Lỗi" : "Trạng thái"}</div>
          <div className="muted" style={{ color: errorMessage ? "var(--danger)" : undefined }}>
            {errorMessage || statusMessage}
          </div>
        </div>
      )}

      <div className="card">
        <div className="segmented">
          <button
            type="button"
            className={`segmented-button ${tab === "extensions" ? "active" : ""}`}
            onClick={() => setTab("extensions")}
          >
            Extensions
          </button>
          <button
            type="button"
            className={`segmented-button ${tab === "keys" ? "active" : ""}`}
            onClick={() => setTab("keys")}
          >
            Keys
          </button>
          <button
            type="button"
            className={`segmented-button ${tab === "activations" ? "active" : ""}`}
            onClick={() => setTab("activations")}
          >
            Activations
          </button>
        </div>
      </div>

      {tab === "extensions" && (
        <>
          <div className="card">
            <h3 className="section-title">Tạo Extension</h3>
            <form className="grid" style={{ gap: 14 }} onSubmit={handleCreateExtension}>
              <div className="form-grid">
                <input
                  className="input"
                  placeholder="Code công khai, ví dụ: EMAIL_INBOX"
                  value={extensionCode}
                  onChange={(event) => setExtensionCode(event.target.value.toUpperCase())}
                  required
                />
                <input
                  className="input"
                  placeholder="Tên extension"
                  value={extensionName}
                  onChange={(event) => setExtensionName(event.target.value)}
                  required
                />
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={extensionIsActive}
                    onChange={(event) => setExtensionIsActive(event.target.checked)}
                  />
                  Kích hoạt extension ngay
                </label>
              </div>
              <textarea
                className="textarea"
                placeholder="Mô tả ngắn cho extension"
                value={extensionDescription}
                onChange={(event) => setExtensionDescription(event.target.value)}
              />
              <div className="modal-actions">
                <button className="button" type="submit" disabled={busyAction === "create-extension"}>
                  {busyAction === "create-extension" ? "Đang lưu..." : "Tạo extension"}
                </button>
              </div>
            </form>
          </div>

          <div className="card">
            <div className="license-section-head">
              <h3 className="section-title">Danh sách Extension</h3>
              <div className="muted">
                {loadingExtensions ? "Đang tải..." : `${extensions.length} extension`}
              </div>
            </div>
            <div className="license-table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Tên</th>
                    <th>Mô tả</th>
                    <th>Trạng thái</th>
                    <th>Keys</th>
                    <th>Đang bind</th>
                    <th>Cập nhật</th>
                    <th>Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  {extensions.map((extension) => (
                    <tr key={extension.id}>
                      <td>
                        <div className="license-code">{extension.code}</div>
                      </td>
                      <td>{extension.name}</td>
                      <td className="cell-truncate">{extension.description || "-"}</td>
                      <td>
                        <span className={`license-status ${extension.isActive ? "is-active" : "is-extension-disabled"}`}>
                          {extension.isActive ? "Đang bật" : "Đã tắt"}
                        </span>
                      </td>
                      <td>{extension.keyCount}</td>
                      <td>{extension.activeActivationCount}</td>
                      <td>{formatDateTime(extension.updatedAt)}</td>
                      <td className="row-actions-cell">
                        <RowActionMenu items={[
                          { label: "Sửa", onSelect: () => openEditExtension(extension) },
                          {
                            label: "Xóa",
                            tone: "danger",
                            disabled: busyAction === `delete-extension-${extension.id}`,
                            onSelect: () => setPendingConfirm({ type: "delete-extension", extension })
                          }
                        ]} />
                      </td>
                    </tr>
                  ))}
                  {!extensions.length && (
                    <tr>
                      <td colSpan={8} className="muted">
                        Chưa có extension nào.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === "keys" && (
        <>
          <div className="card">
            <h3 className="section-title">Tạo License Key</h3>
            <form className="grid" style={{ gap: 14 }} onSubmit={handleCreateKey}>
              <div className="form-grid">
                <select
                  className="select"
                  value={keyExtensionId}
                  onChange={(event) => setKeyExtensionId(event.target.value)}
                  required
                >
                  <option value="">Chọn extension</option>
                  {extensionOptions.map((extension) => (
                    <option key={extension.id} value={extension.id}>
                      {extension.code} - {extension.name}
                    </option>
                  ))}
                </select>
                <input
                  className="input"
                  type="datetime-local"
                  value={keyExpiresAt}
                  onChange={(event) => setKeyExpiresAt(event.target.value)}
                  required
                />
                <select
                  className="select"
                  value={keyDeviceLimitMode}
                  onChange={(event) => setKeyDeviceLimitMode(event.target.value as LicenseKeyDeviceLimitMode)}
                >
                  <option value="single_device">1 thiết bị</option>
                  <option value="unlimited_devices">Không giới hạn thiết bị</option>
                </select>
              </div>
              <textarea
                className="textarea"
                placeholder="Ghi chú nội bộ cho license key"
                value={keyNote}
                onChange={(event) => setKeyNote(event.target.value)}
              />
              <div className="modal-actions">
                <button
                  className="button"
                  type="submit"
                  disabled={!keyExtensionId || busyAction === "create-key"}
                >
                  {busyAction === "create-key" ? "Đang tạo..." : "Tạo key"}
                </button>
              </div>
            </form>
          </div>

          {latestCreatedKey && (
            <div className="card license-secret-box">
              <div className="license-section-head">
                <h3 className="section-title">Raw Key mới tạo</h3>
                <button className="button secondary" type="button" onClick={copyLatestKey}>
                  Copy
                </button>
              </div>
              <p className="muted">
                Raw key chỉ hiển thị tại đây ngay sau khi tạo. Sau khi tải lại trang, dashboard chỉ còn masked key.
              </p>
              <div className="license-secret-code">{latestCreatedKey.rawKey}</div>
              <div className="license-secret-meta">
                <span>Extension: {latestCreatedKey.extensionCode || "-"}</span>
                <span>Masked: {latestCreatedKey.maskedKey || "-"}</span>
                <span>Hết hạn: {formatDateTime(latestCreatedKey.expiresAt)}</span>
              </div>
            </div>
          )}

          <div className="card">
            <div className="license-section-head">
              <h3 className="section-title">Danh sách Key</h3>
              <div className="license-filter-bar">
                <select
                  className="select"
                  value={keyFilterExtensionId}
                  onChange={(event) => setKeyFilterExtensionId(event.target.value)}
                >
                  <option value="all">Tất cả extension</option>
                  {extensionOptions.map((extension) => (
                    <option key={extension.id} value={extension.id}>
                      {extension.code}
                    </option>
                  ))}
                </select>
                <select
                  className="select"
                  value={keyFilterStatus}
                  onChange={(event) => setKeyFilterStatus(event.target.value as LicenseKeyAdminStatus | "all")}
                >
                  <option value="all">Tất cả trạng thái</option>
                  <option value="active">Đang hoạt động</option>
                  <option value="expired">Hết hạn</option>
                  <option value="revoked">Đã thu hồi</option>
                </select>
              </div>
            </div>
            <div className="license-table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Extension</th>
                    <th>Trạng thái</th>
                    <th>Thiết bị</th>
                    <th>Fingerprints đang bind</th>
                    <th>Hết hạn</th>
                    <th>Ghi chú</th>
                    <th>Tạo lúc</th>
                    <th>Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map((key) => (
                    <tr key={key.id}>
                      <td>
                        <div className="license-code">{key.maskedKey}</div>
                      </td>
                      <td>
                        {key.extensionCode}
                        <div className="muted">{key.extensionName}</div>
                      </td>
                      <td>
                        <span className={`license-status license-status-${key.status}`}>
                          {getKeyStatusLabel(key.status)}
                        </span>
                      </td>
                      <td>
                        <div className="license-code">{getDeviceLimitModeLabel(key.deviceLimitMode)}</div>
                        <div className="muted">{key.activeActivationCount} bind đang hoạt động</div>
                      </td>
                      <td className="cell-truncate">{summarizeActiveFingerprints(key)}</td>
                      <td>{formatDateTime(key.expiresAt)}</td>
                      <td className="cell-truncate">{key.note || "-"}</td>
                      <td>{formatDateTime(key.createdAt)}</td>
                      <td className="row-actions-cell">
                        <RowActionMenu
                          items={[
                            { label: "Sửa", onSelect: () => openEditKey(key) },
                            key.status === "revoked"
                              ? {
                                  label: "Mở khóa",
                                  disabled: busyAction === `reactivate-key-${key.id}`,
                                  onSelect: () => handleReactivateKey(key)
                                }
                              : {
                                  label: "Thu hồi",
                                  tone: "warning",
                                  disabled: busyAction === `revoke-key-${key.id}`,
                                  onSelect: () => setPendingConfirm({ type: "revoke-key", key })
                                },
                            {
                              label: "Reset tất cả bind",
                              tone: "danger",
                              disabled: busyAction === `reset-key-${key.id}`,
                              onSelect: () => setPendingConfirm({ type: "reset-key", key })
                            }
                          ]}
                        />
                      </td>
                    </tr>
                  ))}
                  {!keys.length && (
                    <tr>
                      <td colSpan={9} className="muted">
                        Chưa có license key nào.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === "activations" && (
        <div className="card">
          <div className="license-section-head">
            <h3 className="section-title">Danh sách Activation</h3>
            <div className="license-filter-bar">
              <select
                className="select"
                value={activationFilterExtensionId}
                onChange={(event) => setActivationFilterExtensionId(event.target.value)}
              >
                <option value="all">Tất cả extension</option>
                {extensionOptions.map((extension) => (
                  <option key={extension.id} value={extension.id}>
                    {extension.code}
                  </option>
                ))}
              </select>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={activationActiveOnly}
                  onChange={(event) => setActivationActiveOnly(event.target.checked)}
                />
                Chỉ hiện activation đang bind
              </label>
            </div>
          </div>
          <div className="license-table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Extension</th>
                  <th>Fingerprint</th>
                  <th>Trạng thái</th>
                  <th>Activate lúc</th>
                  <th>Check gần nhất</th>
                  <th>Version</th>
                  <th>Hành động</th>
                </tr>
              </thead>
              <tbody>
                {activations.map((activation) => (
                  <tr key={activation.id}>
                    <td>
                      <div className="license-code">{activation.maskedKey}</div>
                      <div className="muted">Hết hạn: {formatDateTime(activation.expiresAt)}</div>
                    </td>
                    <td>
                      {activation.extensionCode}
                      <div className="muted">{activation.extensionName}</div>
                    </td>
                    <td className="cell-truncate">{activation.fingerprint}</td>
                    <td>
                      <span className={`license-status license-status-${activation.status}`}>
                        {getActivationStatusLabel(activation.status)}
                      </span>
                    </td>
                    <td>{formatDateTime(activation.activatedAt)}</td>
                    <td>{formatDateTime(activation.lastCheckedAt)}</td>
                    <td>{activation.lastVersion || "-"}</td>
                    <td className="row-actions-cell">
                      <RowActionMenu items={[
                        {
                          label: "Reset bind này",
                          tone: "danger",
                          disabled: busyAction === `reset-activation-${activation.id}`,
                          onSelect: () => setPendingConfirm({ type: "reset-activation", activation })
                        }
                      ]} />
                    </td>
                  </tr>
                ))}
                {!activations.length && (
                  <tr>
                    <td colSpan={8} className="muted">
                      {loadingActivations ? "Đang tải..." : "Chưa có activation nào."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingConfirm)}
        title={confirmTitle}
        description={confirmDescription}
        confirmLabel={
          pendingConfirm?.type === "delete-extension"
            ? "Xóa extension"
            : pendingConfirm?.type === "revoke-key"
              ? "Thu hồi key"
              : "Reset bind"
        }
        busy={pendingConfirmBusy}
        onConfirm={confirmPendingLicenseAction}
        onCancel={() => setPendingConfirm(null)}
      />

      {editingExtension && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3 className="section-title">Sửa Extension</h3>
            <p className="muted" style={{ marginBottom: 12 }}>
              Code `{editingExtension.code}` là immutable và không thể đổi.
            </p>
            <form className="grid" style={{ gap: 14 }} onSubmit={handleUpdateExtension}>
              <div className="form-grid">
                <input className="input" value={editingExtension.code} disabled />
                <input
                  className="input"
                  value={editExtensionName}
                  onChange={(event) => setEditExtensionName(event.target.value)}
                  required
                />
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={editExtensionIsActive}
                    onChange={(event) => setEditExtensionIsActive(event.target.checked)}
                  />
                  Extension đang hoạt động
                </label>
              </div>
              <textarea
                className="textarea"
                value={editExtensionDescription}
                onChange={(event) => setEditExtensionDescription(event.target.value)}
              />
              <div className="modal-actions">
                <button className="button secondary" type="button" onClick={() => setEditingExtension(null)}>
                  Đóng
                </button>
                <button className="button" type="submit" disabled={busyAction === `save-extension-${editingExtension.id}`}>
                  {busyAction === `save-extension-${editingExtension.id}` ? "Đang lưu..." : "Lưu thay đổi"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingKey && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3 className="section-title">Sửa License Key</h3>
            <p className="muted" style={{ marginBottom: 12 }}>
              Key hiện tại: `{editingKey.maskedKey}` thuộc extension `{editingKey.extensionCode}`.
            </p>
            <form className="grid" style={{ gap: 14 }} onSubmit={handleUpdateKey}>
              <div className="form-grid">
                <input className="input" value={editingKey.extensionCode} disabled />
                <input
                  className="input"
                  type="datetime-local"
                  value={editKeyExpiresAt}
                  onChange={(event) => setEditKeyExpiresAt(event.target.value)}
                  required
                />
                <select
                  className="select"
                  value={editKeyDeviceLimitMode}
                  onChange={(event) => setEditKeyDeviceLimitMode(event.target.value as LicenseKeyDeviceLimitMode)}
                >
                  <option value="single_device">1 thiết bị</option>
                  <option value="unlimited_devices">Không giới hạn thiết bị</option>
                </select>
              </div>
              <textarea
                className="textarea"
                value={editKeyNote}
                onChange={(event) => setEditKeyNote(event.target.value)}
              />
              <div className="modal-actions">
                <button className="button secondary" type="button" onClick={() => setEditingKey(null)}>
                  Đóng
                </button>
                <button className="button" type="submit" disabled={busyAction === `save-key-${editingKey.id}`}>
                  {busyAction === `save-key-${editingKey.id}` ? "Đang lưu..." : "Lưu thay đổi"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
