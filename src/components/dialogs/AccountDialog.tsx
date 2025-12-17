import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { Moon, Sun, Bell, Globe } from "lucide-react";
import { useTheme } from "next-themes";

interface AccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const AccountDialog = ({ open, onOpenChange }: AccountDialogProps) => {
  const [name] = useState("Max Musterman");
  const [role] = useState("Consultant");
  const [notifications, setNotifications] = useState(true);
  const [emailUpdates, setEmailUpdates] = useState(false);
  const { theme, setTheme } = useTheme();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border max-w-md">
        <DialogHeader>
          <DialogTitle className="sr-only">Account & Einstellungen</DialogTitle>
        </DialogHeader>
        
        {/* Profile Section */}
        <div className="flex items-center gap-4 pb-6 border-b border-border">
          <Avatar className="h-16 w-16">
            <AvatarFallback className="bg-primary text-primary-foreground text-xl">
              {name.split(" ").map(n => n[0]).join("")}
            </AvatarFallback>
          </Avatar>
          <div>
            <h3 className="font-medium text-foreground">{name}</h3>
            <p className="text-sm text-muted-foreground">{role}</p>
          </div>
        </div>

        {/* Settings Section */}
        <div className="space-y-4 pt-2">
          {/* Theme Toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {theme === "dark" ? (
                <Moon className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Sun className="h-4 w-4 text-muted-foreground" />
              )}
              <Label htmlFor="theme" className="cursor-pointer font-normal">
                Dark Mode
              </Label>
            </div>
            <Switch
              id="theme"
              checked={theme === "dark"}
              onCheckedChange={(checked) => {
                setTheme(checked ? "dark" : "light");
                toast({
                  title: `${checked ? "Dark" : "Light"} Mode aktiviert`,
                });
              }}
            />
          </div>

          {/* Notifications Toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Bell className="h-4 w-4 text-muted-foreground" />
              <Label htmlFor="notifications" className="cursor-pointer font-normal">
                Push-Benachrichtigungen
              </Label>
            </div>
            <Switch
              id="notifications"
              checked={notifications}
              onCheckedChange={(checked) => {
                setNotifications(checked);
                toast({
                  title: checked ? "Benachrichtigungen aktiviert" : "Benachrichtigungen deaktiviert",
                });
              }}
            />
          </div>

          {/* Email Updates Toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="w-4" /> {/* Spacer for alignment */}
              <Label htmlFor="email-updates" className="cursor-pointer font-normal text-muted-foreground">
                E-Mail Updates
              </Label>
            </div>
            <Switch
              id="email-updates"
              checked={emailUpdates}
              onCheckedChange={(checked) => {
                setEmailUpdates(checked);
                toast({
                  title: checked ? "E-Mail Updates aktiviert" : "E-Mail Updates deaktiviert",
                });
              }}
            />
          </div>

          {/* Language Info */}
          <div className="flex items-center gap-3 pt-2 border-t border-border">
            <Globe className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Deutsch (Deutschland)</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AccountDialog;
