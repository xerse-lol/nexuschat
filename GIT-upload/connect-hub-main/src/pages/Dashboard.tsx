import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import Sidebar from '@/components/layout/Sidebar';
import VideoChat from '@/components/video/VideoChat';
import DirectMessages from '@/components/messages/DirectMessages';
import RoomsList from '@/components/rooms/RoomsList';
import CreateRoom from '@/components/rooms/CreateRoom';
import ProfilePage from '@/components/profile/ProfilePage';
import SettingsPage from '@/components/settings/SettingsPage';
import HomePage from '@/components/home/HomePage';
import ShopPage from '@/components/shop/ShopPage';

export default function Dashboard() {
  const { user, isLoading } = useAuth();
  const [activeTab, setActiveTab] = useState('home');

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'home':
        return <HomePage onNavigate={setActiveTab} />;
      case 'video':
        return <VideoChat />;
      case 'messages':
        return <DirectMessages />;
      case 'rooms':
        return <RoomsList />;
      case 'shop':
        return <ShopPage />;
      case 'create':
        return <CreateRoom />;
      case 'profile':
        return <ProfilePage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <HomePage onNavigate={setActiveTab} />;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
      <main className="ml-[72px] p-6 min-h-screen">
        {renderContent()}
      </main>
    </div>
  );
}
