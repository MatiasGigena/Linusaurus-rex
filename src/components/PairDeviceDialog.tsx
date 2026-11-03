import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, ExternalLink, RefreshCw } from 'lucide-react';
import { Dialog } from './Dialog';
import { errorMessage } from '../core/workspace';
export function PairDeviceDialog({
  hostId,
  endpoint,
  onClose,
  onManage,
}: {
  hostId: string;
  endpoint?: string;
  onClose(): void;
  onManage(): void;
}) {
  const [address, setAddress] = useState('');
  const [authUrl, setAuthUrl] = useState('');
  const [image, setImage] = useState('');
  const [state, setState] = useState('Checking remote address…');
  const load = async () => {
    setImage('');
    setAddress('');
    setAuthUrl('');
    try {
      const status = (await window.rex.request('serverAction', { hostId, action: 'status' })) as {
        tailscale?: {
          https?: { url?: string; state?: string };
          state?: string;
          auth_url?: string;
          dns_name?: string;
        };
      };
      const url =
        status.tailscale?.https?.url || (/^https:\/\//.test(endpoint || '') ? endpoint : '') || '';
      setAddress(url);
      setAuthUrl(status.tailscale?.auth_url || '');
      setState(
        url
          ? 'Scan this server address on your other device. The device must have network access and permission to connect.'
          : `Remote address is ${status.tailscale?.state || 'unavailable'}. Enable remote serving or finish sign-in first.`,
      );
      if (url)
        setImage(
          await QRCode.toDataURL(url, {
            width: 240,
            margin: 2,
            errorCorrectionLevel: 'M',
            color: { dark: '#233228', light: '#eef5eb' },
          }),
        );
    } catch (failure) {
      setState(errorMessage(failure));
    }
  };
  useEffect(() => {
    void load();
  }, [hostId, endpoint]);
  return (
    <Dialog
      title="Connect another device"
      subtitle="Share this Rex server’s remote address."
      onClose={onClose}
    >
      <div className="pair-device">
        {image && (
          <img
            src={image}
            alt="QR code containing the Rex server's HTTPS address"
            width={240}
            height={240}
          />
        )}
        <p>{state}</p>
        {address && <code>{address}</code>}
      </div>
      <div className="dialog-actions">
        <button className="button" onClick={() => void load()}>
          <RefreshCw size={13} />
          Refresh
        </button>
        {authUrl && (
          <button
            className="button"
            onClick={() => void window.rex.request('openExternal', { url: authUrl })}
          >
            <ExternalLink size={13} />
            Sign in
          </button>
        )}
        {address ? (
          <button
            className="button button-primary"
            onClick={() => void window.rex.writeClipboard(address)}
          >
            <Copy size={13} />
            Copy address
          </button>
        ) : (
          <button className="button button-primary" onClick={onManage}>
            Remote access settings
          </button>
        )}
      </div>
    </Dialog>
  );
}
