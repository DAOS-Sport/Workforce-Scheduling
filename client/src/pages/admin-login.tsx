import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ShieldCheck, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface AdminLoginProps {
  onLoginSuccess: () => void;
}

export default function AdminLoginPage({ onLoginSuccess }: AdminLoginProps) {
  const [location, setLocation] = useLocation();
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code && !processing) {
      setProcessing(true);
      handleCallback(code);
    }
  }, []);

  async function handleCallback(code: string) {
    try {
      setError("");
      const redirectUri = `${window.location.origin}/admin/callback`;
      const res = await apiRequest("POST", "/api/admin/line-callback", { code, redirectUri });
      const data = await res.json();
      if (data.id) {
        window.history.replaceState({}, "", "/");
        onLoginSuccess();
      }
    } catch (err: any) {
      const msg = err.message || "登入失敗";
      setError(msg);
      window.history.replaceState({}, "", "/");
    } finally {
      setProcessing(false);
    }
  }

  function handleLineLogin() {
    const channelId = import.meta.env.VITE_LINE_CHANNEL_ID;
    if (!channelId) {
      setError("LINE Login 尚未設定，請聯繫系統管理員");
      return;
    }
    const redirectUri = encodeURIComponent(`${window.location.origin}/admin/callback`);
    const state = Math.random().toString(36).substring(7);
    const lineAuthUrl = `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=${channelId}&redirect_uri=${redirectUri}&state=${state}&scope=profile%20openid`;
    window.location.href = lineAuthUrl;
  }

  if (processing) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
        <Card className="w-full max-w-sm p-8 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-blue-500" />
          <p className="text-sm text-muted-foreground">正在驗證身份...</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6" data-testid="admin-login-page">
      <Card className="w-full max-w-sm p-8">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-500/25">
            <ShieldCheck className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-xl font-bold text-foreground mb-1" data-testid="text-admin-login-title">三蘆智慧管理</h1>
          <p className="text-sm text-muted-foreground">管理後台登入</p>
        </div>

        {error && (
          <div className="mb-6 p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800" data-testid="text-admin-login-error">
            <p className="text-sm text-red-600 dark:text-red-400 text-center">{error}</p>
          </div>
        )}

        <Button
          className="w-full h-12 text-base font-semibold bg-[#06C755] hover:bg-[#05b34c] text-white"
          onClick={handleLineLogin}
          data-testid="button-admin-line-login"
        >
          <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
          </svg>
          使用 LINE 帳號登入
        </Button>

        <p className="mt-4 text-xs text-center text-muted-foreground">
          僅限管理員帳號登入
        </p>
      </Card>
    </div>
  );
}
