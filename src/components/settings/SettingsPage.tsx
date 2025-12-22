import { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  User, 
  Bell, 
  Shield, 
  Palette, 
  Volume2, 
  Video, 
  Globe,
  Lock,
  Eye,
  EyeOff,
  Moon,
  Sun,
  Monitor
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

export default function SettingsPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  
  // Account settings
  const [showEmail, setShowEmail] = useState(false);
  
  // Notification settings
  const [notifications, setNotifications] = useState({
    messages: true,
    rooms: true,
    connections: true,
    sounds: true,
  });
  
  // Privacy settings
  const [privacy, setPrivacy] = useState({
    showOnline: true,
    allowDMs: true,
    showActivity: true,
  });
  
  // Audio/Video settings
  const [mediaSettings, setMediaSettings] = useState({
    inputVolume: [75],
    outputVolume: [80],
    noiseSupression: true,
    echoCancellation: true,
    autoGainControl: true,
  });
  
  // Appearance
  const [theme, setTheme] = useState('dark');
  const [language, setLanguage] = useState('en');

  const handleSave = () => {
    toast({
      title: "Settings Saved",
      description: "Your preferences have been updated",
    });
  };

  const settingsSections = [
    { id: 'account', label: 'Account', icon: User },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'privacy', label: 'Privacy', icon: Shield },
    { id: 'audio-video', label: 'Audio & Video', icon: Video },
    { id: 'appearance', label: 'Appearance', icon: Palette },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-display font-bold text-foreground mb-2">Settings</h1>
          <p className="text-muted-foreground">Manage your account and preferences</p>
        </div>

        <Tabs defaultValue="account" className="space-y-6">
          <TabsList className="bg-secondary p-1 rounded-xl flex-wrap h-auto gap-1">
            {settingsSections.map(section => (
              <TabsTrigger 
                key={section.id} 
                value={section.id}
                className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-lg gap-2"
              >
                <section.icon className="w-4 h-4" />
                {section.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Account Settings */}
          <TabsContent value="account">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              <div className="bg-card rounded-2xl border border-border p-6 space-y-6">
                <h3 className="font-display font-semibold text-lg">Account Details</h3>
                
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Email Address</Label>
                    <div className="flex gap-2">
                      <Input 
                        type={showEmail ? 'text' : 'password'}
                        value={user?.email ?? ''}
                        readOnly
                        className="bg-secondary border-0"
                      />
                      <Button 
                        variant="outline" 
                        size="icon"
                        onClick={() => setShowEmail(!showEmail)}
                      >
                        {showEmail ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Username</Label>
                    <Input 
                      value={user?.username ?? ''}
                      readOnly
                      className="bg-secondary border-0"
                    />
                  </div>
                </div>

                <div className="pt-4 border-t border-border">
                  <h4 className="font-medium mb-4">Danger Zone</h4>
                  <div className="flex gap-3">
                    <Button variant="outline">Change Password</Button>
                    <Button variant="destructive">Delete Account</Button>
                  </div>
                </div>
              </div>
            </motion.div>
          </TabsContent>

          {/* Notification Settings */}
          <TabsContent value="notifications">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-card rounded-2xl border border-border p-6 space-y-6"
            >
              <h3 className="font-display font-semibold text-lg">Notification Preferences</h3>
              
              <div className="space-y-4">
                {[
                  { key: 'messages', label: 'Direct Messages', desc: 'Get notified when you receive a message' },
                  { key: 'rooms', label: 'Room Activity', desc: 'Notifications from rooms you\'ve joined' },
                  { key: 'connections', label: 'Connection Requests', desc: 'When someone wants to connect' },
                  { key: 'sounds', label: 'Sound Effects', desc: 'Play sounds for notifications' },
                ].map(item => (
                  <div key={item.key} className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-medium">{item.label}</p>
                      <p className="text-sm text-muted-foreground">{item.desc}</p>
                    </div>
                    <Switch 
                      checked={notifications[item.key as keyof typeof notifications]}
                      onCheckedChange={(checked) => 
                        setNotifications(prev => ({ ...prev, [item.key]: checked }))
                      }
                    />
                  </div>
                ))}
              </div>
            </motion.div>
          </TabsContent>

          {/* Privacy Settings */}
          <TabsContent value="privacy">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-card rounded-2xl border border-border p-6 space-y-6"
            >
              <h3 className="font-display font-semibold text-lg">Privacy Settings</h3>
              
              <div className="space-y-4">
                {[
                  { key: 'showOnline', label: 'Show Online Status', desc: 'Let others see when you\'re online' },
                  { key: 'allowDMs', label: 'Allow Direct Messages', desc: 'Receive messages from anyone' },
                  { key: 'showActivity', label: 'Show Activity', desc: 'Display what rooms you\'re in' },
                ].map(item => (
                  <div key={item.key} className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-medium">{item.label}</p>
                      <p className="text-sm text-muted-foreground">{item.desc}</p>
                    </div>
                    <Switch 
                      checked={privacy[item.key as keyof typeof privacy]}
                      onCheckedChange={(checked) => 
                        setPrivacy(prev => ({ ...prev, [item.key]: checked }))
                      }
                    />
                  </div>
                ))}
              </div>
            </motion.div>
          </TabsContent>

          {/* Audio/Video Settings */}
          <TabsContent value="audio-video">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-card rounded-2xl border border-border p-6 space-y-6"
            >
              <h3 className="font-display font-semibold text-lg">Audio & Video</h3>
              
              <div className="space-y-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label>Input Volume</Label>
                    <span className="text-sm text-muted-foreground">{mediaSettings.inputVolume}%</span>
                  </div>
                  <Slider
                    value={mediaSettings.inputVolume}
                    onValueChange={(v) => setMediaSettings(prev => ({ ...prev, inputVolume: v }))}
                    max={100}
                    step={1}
                  />
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label>Output Volume</Label>
                    <span className="text-sm text-muted-foreground">{mediaSettings.outputVolume}%</span>
                  </div>
                  <Slider
                    value={mediaSettings.outputVolume}
                    onValueChange={(v) => setMediaSettings(prev => ({ ...prev, outputVolume: v }))}
                    max={100}
                    step={1}
                  />
                </div>

                <div className="border-t border-border pt-4 space-y-4">
                  {[
                    { key: 'noiseSupression', label: 'Noise Suppression', desc: 'Reduce background noise' },
                    { key: 'echoCancellation', label: 'Echo Cancellation', desc: 'Prevent audio feedback' },
                    { key: 'autoGainControl', label: 'Auto Gain Control', desc: 'Automatically adjust mic volume' },
                  ].map(item => (
                    <div key={item.key} className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{item.label}</p>
                        <p className="text-sm text-muted-foreground">{item.desc}</p>
                      </div>
                      <Switch 
                        checked={mediaSettings[item.key as keyof typeof mediaSettings] as boolean}
                        onCheckedChange={(checked) => 
                          setMediaSettings(prev => ({ ...prev, [item.key]: checked }))
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </TabsContent>

          {/* Appearance Settings */}
          <TabsContent value="appearance">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-card rounded-2xl border border-border p-6 space-y-6"
            >
              <h3 className="font-display font-semibold text-lg">Appearance</h3>
              
              <div className="space-y-6">
                <div className="space-y-3">
                  <Label>Theme</Label>
                  <div className="flex gap-3">
                    {[
                      { id: 'light', label: 'Light', icon: Sun },
                      { id: 'dark', label: 'Dark', icon: Moon },
                      { id: 'system', label: 'System', icon: Monitor },
                    ].map(t => (
                      <motion.button
                        key={t.id}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => setTheme(t.id)}
                        className={cn(
                          "flex-1 p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-2",
                          theme === t.id
                            ? "border-primary bg-primary/10"
                            : "border-border bg-secondary hover:border-primary/50"
                        )}
                      >
                        <t.icon className="w-6 h-6" />
                        <span className="text-sm font-medium">{t.label}</span>
                      </motion.button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Language</Label>
                  <Select value={language} onValueChange={setLanguage}>
                    <SelectTrigger className="bg-secondary border-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="es">Español</SelectItem>
                      <SelectItem value="fr">Français</SelectItem>
                      <SelectItem value="de">Deutsch</SelectItem>
                      <SelectItem value="ja">日本語</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </motion.div>
          </TabsContent>
        </Tabs>

        <div className="mt-8 flex justify-end">
          <Button variant="hero" size="lg" onClick={handleSave}>
            Save All Changes
          </Button>
        </div>
      </div>
    </div>
  );
}
