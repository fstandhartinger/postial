"use client";

import { useEffect, useState } from 'react';
import { DEPLOYMENT_SKEW_MESSAGE, isDeploymentSkewError } from '@/lib/deployment-skew';

export function DeploymentSkewNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const showIfSkew = (value: unknown) => {
      if (isDeploymentSkewError(value)) setVisible(true);
    };
    const onError = (event: ErrorEvent) => showIfSkew(event.error ?? event.message);
    const onRejection = (event: PromiseRejectionEvent) => showIfSkew(event.reason);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  if (!visible) return null;
  return <DeploymentSkewMessage />;
}

export function DeploymentSkewMessage() {
  return (
    <div role="alert" className="fixed inset-x-4 top-4 z-50 mx-auto max-w-xl rounded-xl border border-emerald-200 bg-white p-5 shadow-lg">
      <p className="font-semibold">A quick refresh is needed</p>
      <p className="mt-2 text-sm text-zinc-700">{DEPLOYMENT_SKEW_MESSAGE}</p>
      <button type="button" onClick={() => window.location.reload()} className="mt-4 rounded bg-emerald-700 px-4 py-2 font-semibold text-white">
        Reload page
      </button>
    </div>
  );
}
