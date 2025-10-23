import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { Moon, Sun, Bell, Globe, Pencil } from "lucide-react";
import { useTheme } from "next-themes";

interface AccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeTab?: "account" | "settings";
}

const AccountDialog = ({ open, onOpenChange, activeTab = "account" }: AccountDialogProps) => {
  const [name, setName] = useState("Max Musterman");
  const [role, setRole] = useState("Consultant");
  const [notifications, setNotifications] = useState(true);
  const [emailUpdates, setEmailUpdates] = useState(false);
  const [currentTab, setCurrentTab] = useState(activeTab);
  const { theme, setTheme } = useTheme();

  // Update tab when activeTab prop changes
  useEffect(() => {
    setCurrentTab(activeTab);
  }, [activeTab]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border max-w-xl min-h-[520px]">
        <Tabs
          value={currentTab}
          onValueChange={(value) => setCurrentTab(value as "account" | "settings")}
          className="mt-8 w-full"
        >
          <TabsList className="inline-flex items-center gap-2 rounded-full bg-foreground/5 p-1 text-sm">
            <TabsTrigger
              value="account"
              className="rounded-full px-4 py-2 text-sm font-medium text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=active]:bg-background data-[state=active]:text-accent"
            >
              Account
            </TabsTrigger>
            <TabsTrigger
              value="settings"
              className="rounded-full px-4 py-2 text-sm font-medium text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=active]:bg-background data-[state=active]:text-accent"
            >
              Settings
            </TabsTrigger>
          </TabsList>
          <TabsContent value="account" className="space-y-6 py-6">
            <div className="flex flex-col items-center gap-4">
              <Avatar className="h-24 w-24">
                <AvatarFallback className="bg-primary text-primary-foreground text-3xl">
                  {name.split(" ").map(n => n[0]).join("")}
                </AvatarFallback>
              </Avatar>
              
              <div className="w-full space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <div className="relative">
                    <Input
                      id="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      disabled
                      className="pr-10"
                    />
                    <Pencil className="pointer-events-none absolute inset-y-0 right-3 my-auto h-4 w-4 text-muted-foreground/50" />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="role">Rolle</Label>
                  <div className="relative">
                    <Input
                      id="role"
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                      disabled
                      className="pr-10"
                    />
                    <Pencil className="pointer-events-none absolute inset-y-0 right-3 my-auto h-4 w-4 text-muted-foreground/50" />
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>
          <TabsContent value="settings" className="py-6 space-y-6">
            <div className="space-y-6">
              <div className="space-y-4">
                <h3 className="text-sm font-medium">Darstellung</h3>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {theme === "dark" ? (
                      <Moon className="h-4 w-4" />
                    ) : (
                      <Sun className="h-4 w-4" />
                    )}
                    <Label htmlFor="theme" className="cursor-pointer">
                      Dark Mode
                    </Label>
                  </div>
                  <Switch
                    id="theme"
                    checked={theme === "dark"}
                    onCheckedChange={(checked) => {
                      setTheme(checked ? "dark" : "light");
                      toast({
                        title: "Theme geändert",
                        description: `${checked ? "Dark" : "Light"} Mode aktiviert.`,
                      });
                    }}
                  />
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-sm font-medium">Benachrichtigungen</h3>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bell className="h-4 w-4" />
                    <Label htmlFor="notifications" className="cursor-pointer">
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
                <div className="flex items-center justify-between">
                  <Label htmlFor="email-updates" className="cursor-pointer">
                    E-Mail Updates
                  </Label>
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
              </div>

              <div className="space-y-4">
                <h3 className="text-sm font-medium">Sprache & Region</h3>
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4" />
                  <span className="text-sm text-muted-foreground">Deutsch (Deutschland)</span>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export default AccountDialog;
