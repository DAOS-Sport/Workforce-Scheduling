import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ShieldCheck, Loader2, Lock } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface AdminLoginProps {
  onLoginSuccess: () => void;
}

export default function AdminLoginPage({ onLoginSuccess }: AdminLoginProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) {
      setError("請輸入密碼");
      return;
    }
    setProcessing(true);
    setError("");
    try {
      const res = await apiRequest("POST", "/api/admin/login", { password });
      const data = await res.json();
      if (data.id !== undefined) {
        onLoginSuccess();
      }
    } catch (err: any) {
      setError(err.message || "登入失敗");
    } finally {
      setProcessing(false);
    }
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

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="password"
              placeholder="請輸入管理密碼"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pl-10 h-12"
              autoFocus
              data-testid="input-admin-password"
            />
          </div>
          <Button
            type="submit"
            className="w-full h-12 text-base font-semibold"
            disabled={processing}
            data-testid="button-admin-login"
          >
            {processing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                驗證中...
              </>
            ) : (
              "登入"
            )}
          </Button>
        </form>

        <p className="mt-4 text-xs text-center text-muted-foreground">
          僅限管理員登入
        </p>
      </Card>
    </div>
  );
}
