import { useState } from "react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { Moon, Sun, Bell, Globe } from "lucide-react";
import { useTheme } from "next-themes";

interface AccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeTab?: "account" | "settings";
}

const AccountDialog = ({ open, onOpenChange, activeTab = "account" }: AccountDialogProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState("Max Musterman");
  const [role, setRole] = useState("Consultant");
  const [notifications, setNotifications] = useState(true);
  const [emailUpdates, setEmailUpdates] = useState(false);
  const { theme, setTheme } = useTheme();

  const handleSave = () => {
    setIsEditing(false);
    toast({
      title: "Änderungen gespeichert",
      description: "Ihre Profildaten wurden erfolgreich aktualisiert.",
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border max-w-xl">
        <Tabs value={activeTab} defaultValue={activeTab} className="w-full mt-8">
          <TabsList className="grid w-full grid-cols-2 bg-muted">
            <TabsTrigger value="account">Account</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
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
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={!isEditing}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="role">Rolle</Label>
                  <Input
                    id="role"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    disabled={!isEditing}
                  />
                </div>

                <div className="flex gap-2 justify-end">
                  {isEditing ? (
                    <>
                      <Button variant="outline" onClick={() => setIsEditing(false)}>
                        Abbrechen
                      </Button>
                      <Button onClick={handleSave}>
                        Speichern
                      </Button>
                    </>
                  ) : (
                    <Button onClick={() => setIsEditing(true)}>
                      Bearbeiten
                    </Button>
                  )}
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
