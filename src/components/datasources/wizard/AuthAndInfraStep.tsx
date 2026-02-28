import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import InfoTooltip from "@/components/InfoTooltip";
import type { DataSourceFormData } from "@/types/dataSource";

interface AuthAndInfraStepProps {
  formData: DataSourceFormData;
  setFormData: (data: DataSourceFormData) => void;
}

export function AuthAndInfraStep({ formData, setFormData }: AuthAndInfraStepProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor="auth-type">Authentifizierung</Label>
          <InfoTooltip
            content={
              <div className="space-y-1">
                <p>Wählen Sie das Verfahren, das die Datenquelle erwartet.</p>
                <p>Die Maske blendet automatisch die benötigten Felder ein.</p>
              </div>
            }
          />
        </div>
        <Select
          value={formData.auth_type}
          onValueChange={(value) => setFormData({ ...formData, auth_type: value })}
        >
          <SelectTrigger id="auth-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="api_key">API Key</SelectItem>
            <SelectItem value="basic">Basic Auth</SelectItem>
            <SelectItem value="oauth2">OAuth2</SelectItem>
            <SelectItem value="custom">Custom (Keycloak)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="api_key">API Key</Label>
            <InfoTooltip
              content={
                <div className="space-y-1">
                  <p>Geben Sie den Key exakt so ein, wie er vom Provider geliefert wurde.</p>
                  <p>Falls der Key nur temporär gültig ist, ergänzen Sie das Ablaufdatum.</p>
                </div>
              }
            />
          </div>
          <Input
            id="api_key"
            value={formData.api_key}
            onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="username">Benutzername</Label>
          <Input
            id="username"
            value={formData.username}
            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
          />
        </div>
        <div className="space-y-2 md:col-span-2 lg:col-span-1">
          <Label htmlFor="password">Passwort</Label>
          <Input
            id="password"
            type="password"
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
          />
        </div>
      </div>

      {formData.auth_type === "oauth2" && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="client-id">Client ID</Label>
            <Input
              id="client-id"
              value={formData.clientId}
              onChange={(e) => setFormData({ ...formData, clientId: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="client-secret">Client Secret</Label>
            <Input
              id="client-secret"
              type="password"
              value={formData.clientSecret}
              onChange={(e) => setFormData({ ...formData, clientSecret: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="auth-url">Authorization URL</Label>
            <Input
              id="auth-url"
              value={formData.authUrl}
              onChange={(e) => setFormData({ ...formData, authUrl: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="token-url">Token URL</Label>
            <Input
              id="token-url"
              value={formData.tokenUrl}
              onChange={(e) => setFormData({ ...formData, tokenUrl: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="scope">Scope</Label>
            <Input
              id="scope"
              value={formData.scope}
              onChange={(e) => setFormData({ ...formData, scope: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="redirect-uri">Redirect URI</Label>
            <Input
              id="redirect-uri"
              value={formData.redirectUri}
              onChange={(e) => setFormData({ ...formData, redirectUri: e.target.value })}
            />
          </div>
        </div>
      )}

      {formData.auth_type === "custom" && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="realm">Realm</Label>
            <Input
              id="realm"
              value={formData.realm}
              onChange={(e) => setFormData({ ...formData, realm: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="issuer">Issuer URL</Label>
            <Input
              id="issuer"
              value={formData.issuer}
              onChange={(e) => setFormData({ ...formData, issuer: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="custom-client-id">Client ID</Label>
            <Input
              id="custom-client-id"
              value={formData.clientId}
              onChange={(e) => setFormData({ ...formData, clientId: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="custom-client-secret">Client Secret</Label>
            <Input
              id="custom-client-secret"
              type="password"
              value={formData.clientSecret}
              onChange={(e) => setFormData({ ...formData, clientSecret: e.target.value })}
            />
          </div>
        </div>
      )}

      <div className="space-y-4 rounded-2xl border border-border/50 p-4">
        <h3 className="text-sm font-semibold text-foreground">🧱 Infrastruktur</h3>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">SSL-Verifizierung aktiv</span>
          <Switch
            checked={formData.sslVerification}
            onCheckedChange={(checked) => setFormData({ ...formData, sslVerification: checked })}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="proxy-host">Proxy Host</Label>
            <Input
              id="proxy-host"
              value={formData.proxyHost}
              onChange={(e) => setFormData({ ...formData, proxyHost: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="proxy-port">Proxy Port</Label>
            <Input
              id="proxy-port"
              value={formData.proxyPort}
              onChange={(e) => setFormData({ ...formData, proxyPort: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vpn-settings">VPN / Tunnel</Label>
            <Input
              id="vpn-settings"
              placeholder="Konfigurationshinweise"
              value={formData.vpnSettings}
              onChange={(e) => setFormData({ ...formData, vpnSettings: e.target.value })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}