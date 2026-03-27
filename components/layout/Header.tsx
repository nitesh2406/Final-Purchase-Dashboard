import React, { useState, useEffect, useRef, FC } from 'react';
import { BellIcon, UserCircleIcon, ExclamationTriangleIcon, CalendarDaysIcon, CheckBadgeIcon } from '../icons/Icons';
import { Notification } from '../../types';

interface HeaderProps {
  currentView: string;
  notifications: Notification[];
  setNotifications: React.Dispatch<React.SetStateAction<Notification[]>>;
  user?: any;
  onLogout?: () => void;
}

const formatCurrency = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);

const timeSince = (date: Date): string => {
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + " years ago";
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + " months ago";
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + " days ago";
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + " hours ago";
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + " minutes ago";
    return Math.floor(seconds) + " seconds ago";
}

const NotificationIcon: FC<{type: Notification['type']}> = ({type}) => {
    const iconClass = "w-6 h-6 rounded-full p-1";
    switch(type) {
        case 'overdue': return <ExclamationTriangleIcon className={`${iconClass} bg-red-100 text-red-600`} />;
        case 'due_soon': return <CalendarDaysIcon className={`${iconClass} bg-yellow-100 text-yellow-600`} />;
        case 'payment_success': return <CheckBadgeIcon className={`${iconClass} bg-green-100 text-green-600`} />;
        default: return <BellIcon className={`${iconClass} bg-gray-100 text-gray-600`} />;
    }
}


export const Header: React.FC<HeaderProps> = ({ currentView, notifications, setNotifications, user, onLogout }) => {
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const bellRef = useRef<HTMLButtonElement>(null);

    const unreadCount = notifications.filter(n => !n.read).length;

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (
                dropdownRef.current && !dropdownRef.current.contains(event.target as Node) &&
                bellRef.current && !bellRef.current.contains(event.target as Node)
            ) {
                setIsDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleMarkAllRead = () => {
        setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    };

    const handleNotificationClick = (id: string) => {
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
        // In a real app, you would navigate to the related item
        // e.g., setView('Finance'); and pass the relatedId
    };
    
  return (
    <header className="flex items-center justify-between h-20 px-4 sm:px-6 lg:px-8 bg-white dark:bg-gray-800 border-b dark:border-gray-700 flex-shrink-0">
      <h2 className="text-2xl font-semibold text-gray-800 dark:text-white">{currentView}</h2>
      <div className="flex items-center space-x-4">
        <div className="relative">
            <button 
                ref={bellRef}
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="relative p-2 rounded-full text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500">
                <BellIcon className="w-6 h-6" />
                {unreadCount > 0 && (
                    <span className="absolute top-0 right-0 h-5 w-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center border-2 border-white dark:border-gray-800">
                        {unreadCount}
                    </span>
                )}
            </button>
            {isDropdownOpen && (
                <div 
                    ref={dropdownRef}
                    className="absolute right-0 mt-2 w-80 sm:w-96 bg-white dark:bg-gray-800 rounded-lg shadow-xl border dark:border-gray-700 z-50 overflow-hidden flex flex-col"
                >
                    <div className="flex justify-between items-center p-3 border-b dark:border-gray-700">
                        <h4 className="font-semibold">Notifications ({unreadCount})</h4>
                        {unreadCount > 0 && <button onClick={handleMarkAllRead} className="text-xs text-primary-500 hover:underline">Mark all as read</button>}
                    </div>
                    <ul className="max-h-96 overflow-y-auto divide-y dark:divide-gray-700">
                        {notifications.sort((a,b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).map(notification => (
                            <li 
                                key={notification.id} 
                                onClick={() => handleNotificationClick(notification.id)}
                                className={`flex items-start gap-3 p-3 cursor-pointer transition-colors ${!notification.read ? 'bg-primary-50 dark:bg-primary-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}
                            >
                                {!notification.read && <div className="w-2.5 h-2.5 bg-primary-500 rounded-full mt-2 flex-shrink-0"></div>}
                                <div className={`flex-shrink-0 ${notification.read ? 'ml-[14px]' : ''}`}>
                                    <NotificationIcon type={notification.type} />
                                </div>
                                <div className="flex-grow">
                                    <p className="text-sm font-medium text-gray-900 dark:text-white">{notification.message}</p>
                                    {notification.amount && <p className="text-sm font-semibold">{formatCurrency(notification.amount)}</p>}
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{timeSince(new Date(notification.timestamp))}</p>
                                </div>
                            </li>
                        ))}
                    </ul>
                    <div className="p-2 border-t dark:border-gray-700 text-center">
                        <button className="text-sm font-medium text-primary-500 hover:underline">View All Notifications</button>
                    </div>
                </div>
            )}
        </div>
        <div className="flex items-center ml-4 border-l dark:border-gray-700 pl-4">
            {user ? (
                <div className="flex items-center gap-3">
                    <div className="hidden sm:flex flex-col items-end">
                        <div className="flex items-center gap-2">
                            <p className="text-sm font-bold text-gray-800 dark:text-white leading-none">{user.name}</p>
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                                user.role === 'ADMIN' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400' :
                                user.role === 'BUYER' ? 'bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400' :
                                'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                            }`}>
                                {user.role}
                            </span>
                        </div>
                    </div>
                    <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-blue-500 to-emerald-400 flex items-center justify-center text-white font-bold text-lg shadow-sm border-2 border-white dark:border-gray-800">
                        {user.name?.charAt(0).toUpperCase() || 'U'}
                    </div>
                    <button 
                        onClick={onLogout}
                        className="ml-2 text-xs font-medium text-gray-500 hover:text-red-500 transition-colors"
                        title="Sign Out"
                    >
                        Logout
                    </button>
                </div>
            ) : (
                <div className="flex items-center">
                    <UserCircleIcon className="w-10 h-10 text-gray-400"/>
                    <div className="ml-2 hidden sm:block">
                        <p className="text-sm font-medium text-gray-800 dark:text-white">Guest</p>
                    </div>
                </div>
            )}
        </div>
      </div>
    </header>
  );
};
