import { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Plus, 
  Lock, 
  Globe, 
  Users, 
  Gamepad2, 
  Music, 
  Code, 
  Coffee,
  Film,
  BookOpen,
  Image,
  Palette
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { cn } from '@/lib/utils';

const categories = [
  { id: 'gaming', name: 'Gaming', icon: Gamepad2, color: 'from-purple-500 to-pink-500' },
  { id: 'music', name: 'Music', icon: Music, color: 'from-cyan-500 to-blue-500' },
  { id: 'tech', name: 'Tech', icon: Code, color: 'from-green-500 to-emerald-500' },
  { id: 'social', name: 'Social', icon: Coffee, color: 'from-orange-500 to-amber-500' },
  { id: 'entertainment', name: 'Entertainment', icon: Film, color: 'from-red-500 to-rose-500' },
  { id: 'education', name: 'Education', icon: BookOpen, color: 'from-indigo-500 to-violet-500' },
];

const themes = [
  { id: 'default', name: 'Default', bg: 'bg-gradient-to-br from-card to-secondary' },
  { id: 'ocean', name: 'Ocean', bg: 'bg-gradient-to-br from-cyan-900/50 to-blue-900/50' },
  { id: 'sunset', name: 'Sunset', bg: 'bg-gradient-to-br from-orange-900/50 to-rose-900/50' },
  { id: 'forest', name: 'Forest', bg: 'bg-gradient-to-br from-green-900/50 to-emerald-900/50' },
  { id: 'galaxy', name: 'Galaxy', bg: 'bg-gradient-to-br from-purple-900/50 to-indigo-900/50' },
  { id: 'midnight', name: 'Midnight', bg: 'bg-gradient-to-br from-slate-900/50 to-zinc-900/50' },
];

export default function CreateRoom() {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [maxMembers, setMaxMembers] = useState([50]);
  const [selectedTheme, setSelectedTheme] = useState('default');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  
  const { toast } = useToast();

  const handleAddTag = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && tagInput.trim() && tags.length < 5) {
      e.preventDefault();
      setTags([...tags, tagInput.trim()]);
      setTagInput('');
    }
  };

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter(t => t !== tag));
  };

  const handleCreate = () => {
    if (!name.trim()) {
      toast({
        title: "Error",
        description: "Please enter a room name",
        variant: "destructive"
      });
      return;
    }
    if (!selectedCategory) {
      toast({
        title: "Error",
        description: "Please select a category",
        variant: "destructive"
      });
      return;
    }

    if (!user) {
      toast({
        title: "Error",
        description: "You must be signed in to create a room",
        variant: "destructive"
      });
      return;
    }

    const trimmedName = name.trim();
    const trimmedDescription = description.trim();

    void (async () => {
      const { data, error } = await supabase
        .from('rooms')
        .insert({
          name: trimmedName,
          description: trimmedDescription || null,
          category: selectedCategory,
          is_private: isPrivate,
          max_members: maxMembers[0],
          theme: selectedTheme,
          tags,
          host_id: user.id,
        })
        .select('id')
        .single();

      if (error || !data) {
        toast({
          title: "Room creation failed",
          description: error?.message || "Please try again",
          variant: "destructive"
        });
        return;
      }

      await supabase.rpc('join_room', { p_room_id: data.id });

      toast({
        title: "Room Created!",
        description: `${trimmedName} is now live`,
      });

      setName('');
      setDescription('');
      setSelectedCategory('');
      setIsPrivate(false);
      setMaxMembers([50]);
      setSelectedTheme('default');
      setTags([]);
      setTagInput('');
    })();
  };

  const selectedCategoryData = categories.find(c => c.id === selectedCategory);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-display font-bold text-foreground mb-2">Create a Room</h1>
          <p className="text-muted-foreground">Set up your own space for video chats and conversations</p>
        </div>

        <div className="space-y-8">
          {/* Room Preview Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
              "rounded-2xl p-6 border border-border",
              themes.find(t => t.id === selectedTheme)?.bg
            )}
          >
            <div className="flex items-start gap-4">
              <div className={cn(
                "w-16 h-16 rounded-xl flex items-center justify-center bg-gradient-to-br",
                selectedCategoryData?.color || 'from-primary to-primary/50'
              )}>
                {selectedCategoryData ? (
                  <selectedCategoryData.icon className="w-8 h-8 text-white" />
                ) : (
                  <Plus className="w-8 h-8 text-white" />
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-display font-semibold text-xl">
                    {name || 'Your Room Name'}
                  </h3>
                  {isPrivate ? (
                    <Lock className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <Globe className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {description || 'Add a description for your room...'}
                </p>
                <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Users className="w-4 h-4" />
                    0/{maxMembers[0]}
                  </span>
                  <span>{selectedCategoryData?.name || 'Category'}</span>
                </div>
              </div>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-4">
                {tags.map(tag => (
                  <span key={tag} className="px-3 py-1 rounded-full bg-background/50 text-sm">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </motion.div>

          {/* Room Name */}
          <div className="space-y-2">
            <Label htmlFor="name">Room Name</Label>
            <Input
              id="name"
              placeholder="Enter room name..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={50}
              className="bg-secondary border-0 h-12"
            />
            <p className="text-xs text-muted-foreground text-right">{name.length}/50</p>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="What's your room about?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={200}
              className="bg-secondary border-0 min-h-[100px] resize-none"
            />
            <p className="text-xs text-muted-foreground text-right">{description.length}/200</p>
          </div>

          {/* Category Selection */}
          <div className="space-y-3">
            <Label>Category</Label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {categories.map(cat => (
                <motion.button
                  key={cat.id}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={cn(
                    "p-4 rounded-xl border-2 transition-all flex items-center gap-3",
                    selectedCategory === cat.id
                      ? "border-primary bg-primary/10"
                      : "border-border bg-card hover:border-primary/50"
                  )}
                >
                  <div className={cn(
                    "w-10 h-10 rounded-lg bg-gradient-to-br flex items-center justify-center",
                    cat.color
                  )}>
                    <cat.icon className="w-5 h-5 text-white" />
                  </div>
                  <span className="font-medium">{cat.name}</span>
                </motion.button>
              ))}
            </div>
          </div>

          {/* Room Theme */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <Palette className="w-4 h-4" />
              Room Theme
            </Label>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
              {themes.map(theme => (
                <motion.button
                  key={theme.id}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setSelectedTheme(theme.id)}
                  className={cn(
                    "aspect-square rounded-xl border-2 transition-all",
                    theme.bg,
                    selectedTheme === theme.id
                      ? "border-primary ring-2 ring-primary/50"
                      : "border-border hover:border-primary/50"
                  )}
                  title={theme.name}
                />
              ))}
            </div>
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <Label>Tags (max 5)</Label>
            <Input
              placeholder="Add tags and press Enter..."
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleAddTag}
              className="bg-secondary border-0 h-12"
              disabled={tags.length >= 5}
            />
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {tags.map(tag => (
                  <motion.button
                    key={tag}
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    onClick={() => handleRemoveTag(tag)}
                    className="px-3 py-1 rounded-full bg-primary/20 text-primary text-sm hover:bg-primary/30 transition-colors"
                  >
                    {tag} ×
                  </motion.button>
                ))}
              </div>
            )}
          </div>

          {/* Settings */}
          <div className="space-y-6 p-6 bg-card rounded-2xl border border-border">
            {/* Privacy */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {isPrivate ? <Lock className="w-5 h-5 text-primary" /> : <Globe className="w-5 h-5 text-primary" />}
                <div>
                  <p className="font-medium">Private Room</p>
                  <p className="text-sm text-muted-foreground">
                    {isPrivate ? 'Only invited members can join' : 'Anyone can join this room'}
                  </p>
                </div>
              </div>
              <Switch checked={isPrivate} onCheckedChange={setIsPrivate} />
            </div>

            {/* Max Members */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Users className="w-5 h-5 text-primary" />
                  <div>
                    <p className="font-medium">Max Members</p>
                    <p className="text-sm text-muted-foreground">Limit: {maxMembers[0]} people</p>
                  </div>
                </div>
                <span className="text-lg font-semibold text-primary">{maxMembers[0]}</span>
              </div>
              <Slider
                value={maxMembers}
                onValueChange={setMaxMembers}
                max={100}
                min={2}
                step={1}
                className="w-full"
              />
            </div>
          </div>

          {/* Create Button */}
          <Button variant="hero" size="xl" className="w-full" onClick={handleCreate}>
            <Plus className="w-5 h-5 mr-2" />
            Create Room
          </Button>
        </div>
      </div>
    </div>
  );
}
