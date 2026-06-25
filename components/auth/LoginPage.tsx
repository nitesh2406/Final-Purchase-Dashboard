import React, { useState } from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { jwtDecode } from 'jwt-decode';
import { APPS_SCRIPT_URL } from '../../constants';

interface LoginPageProps {
    onLoginSuccess: (user: any) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const handleSuccess = async (credentialResponse: any) => {
        setError(null);
        setIsLoading(true);
        try {
            if (!credentialResponse.credential) {
                throw new Error('No credential received');
            }
            const decoded: any = jwtDecode(credentialResponse.credential);
            
            const response = await fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({
                    action: 'verify_user',
                    email: decoded.email
                })
            });

            const data = await response.json();
            
            if (data && data.success) {
                console.log('RAW backend response:', JSON.stringify(data));
                console.log('data.user:', JSON.stringify(data.user));

                if (!data.user) {
                    throw new Error('Login failed: Invalid response from server. Please contact admin.');
                }

                const userObj = {
                    email: data.user.email,
                    name: data.user.name,
                    role: data.user.role,
                    allowedTabs: data.user.allowedTabs,
                    loggedInAt: Date.now()
                };

                console.log('Final userObj being stored:', JSON.stringify(userObj));
                onLoginSuccess(userObj);
            } else {
                setError(data?.message || 'Verification failed. Access denied.');
            }
        } catch (err: any) {
            console.error('Login error:', err);
            setError(err.message || 'An error occurred during sign in.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex h-screen items-center justify-center bg-slate-900 text-white p-4">
            <div className="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl p-8 max-w-sm w-full text-center flex flex-col items-center">
                <div className="w-16 h-16 bg-blue-500/10 rounded-xl flex items-center justify-center mb-6">
                    <span className="text-3xl">📦</span>
                </div>
                
                <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent mb-2">
                    Cubelelo
                </h1>
                <p className="text-slate-400 text-sm font-medium mb-8">
                    Purchase Management Dashboard
                </p>

                {error && (
                    <div className="w-full bg-red-500/10 border border-red-500/30 text-red-400 text-xs rounded-lg p-3 mb-6 text-left">
                        {error}
                    </div>
                )}

                <div className="w-full relative flex flex-col items-center gap-4">
                    {isLoading && (
                        <div className="absolute inset-0 z-10 bg-slate-800/80 backdrop-blur-sm flex items-center justify-center rounded-lg">
                            <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                        </div>
                    )}
                    <GoogleLogin
                        onSuccess={handleSuccess}
                        onError={() => setError('Google sign-in failed. Please try again.')}
                        theme="filled_black"
                        shape="pill"
                        size="large"
                        text="signin_with"
                        width="100%"
                        ux_mode="popup"
                    />
                </div>

                <p className="text-slate-500 text-[10px] sm:text-xs tracking-wider uppercase opacity-80 mt-8">
                    Access restricted to authorised users only
                </p>
            </div>
        </div>
    );
};
