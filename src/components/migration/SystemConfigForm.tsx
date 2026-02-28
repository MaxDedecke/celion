import { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DATA_SOURCE_TYPE_OPTIONS } from "@/constants/sourceTypes";

interface SystemConfigFormProps {
  title: string;
  dotColorClass: string;
  system: string;
  onSystemChange: (value: string) => void;
  url: string;
  onUrlChange: (value: string) => void;
  apiToken: string;
  onApiTokenChange: (value: string) => void;
  email: string;
  onEmailChange: (value: string) => void;
  urlPlaceholder?: string;
  emailPlaceholder?: string;
  children?: ReactNode;
  setError: (error: string | null) => void;
}

export function SystemConfigForm({
  title,
  dotColorClass,
  system,
  onSystemChange,
  url,
  onUrlChange,
  apiToken,
  onApiTokenChange,
  email,
  onEmailChange,
  urlPlaceholder,
  emailPlaceholder,
  children,
  setError,
}: SystemConfigFormProps) {
  return (
    <div className="space-y-6 p-6 rounded-2xl border border-border/60 bg-card/40">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-base flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${dotColorClass}`} />
          {title}
        </h3>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label>System</Label>
          <Select
            value={system}
            onValueChange={(value) => {
              onSystemChange(value);
              setError(null);
            }}
          >
            <SelectTrigger className="bg-input border-border">
              <SelectValue placeholder="Wählen" />
            </SelectTrigger>
            <SelectContent>
              {DATA_SOURCE_TYPE_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>API URL</Label>
          <Input
            value={url}
            onChange={(e) => {
              onUrlChange(e.target.value);
              setError(null);
            }}
            className="bg-input border-border"
            placeholder={urlPlaceholder}
          />
        </div>

        {children}

        <div className="space-y-2">
          <Label>API-Token</Label>
          <Input
            type="password"
            value={apiToken}
            onChange={(e) => {
              onApiTokenChange(e.target.value);
              setError(null);
            }}
            className="bg-input border-border"
            placeholder="Token"
          />
        </div>

        <div className="space-y-2">
          <Label>E-Mail (Optional)</Label>
          <Input
            type="email"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            className="bg-input border-border"
            placeholder={emailPlaceholder || "admin@example.com"}
          />
        </div>
      </div>
    </div>
  );
}