import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Input,
  Radio,
  Result,
  Space,
  Spin,
  Typography,
} from 'antd';
import { QRCodeSVG } from 'qrcode.react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type PublicOrder } from '../../api';
import { useCart } from '../../cart';
import DeliveredKeys from '../../components/DeliveredKeys';

type PayOrder = {
  outTradeNo: string;
  totalAmount: string;
  subject: string;
  qrCode: string | null;
  payUrl?: string;
  payScheme?: string;
  payMethod?: string;
  paymentMethod?: string;
  status: string;
  usdt?: {
    address: string;
    amount: string;
    network: string;
    expireAt?: string;
    paymentUrl?: string;
    qrContent: string;
  };
};

type PayMethod = { id: string; label: string };

const HTTP_PAY_HINT =
  '当前不是通过 HTTPS 域名访问。请改用店铺的 HTTPS 地址打开后再支付，否则可能无法生成收款码。';

function isInsecurePublicHttp(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.location.protocol === 'https:') return false;
  const host = window.location.hostname.toLowerCase();
  return !(
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.localhost')
  );
}

function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message.trim() : '';
  return msg || '生成收款码失败，请稍后重试';
}

function isUsdtPay(order?: { paymentMethod?: string; payMethod?: string; usdt?: { network?: string } } | null): boolean {
  if (!order) return false;
  if ((order.paymentMethod || '').startsWith('usdt_')) return true;
  if (order.usdt?.network) return true;
  const name = (order.payMethod || '').toUpperCase();
  return name === 'USDT' || name.startsWith('USDT (');
}

function scanHint(order: PayOrder): string {
  const name = order.payMethod || '支付宝';
  if (isUsdtPay(order)) {
    const net = order.usdt?.network || '对应网络';
    return `请务必在「${net}」向收款地址转入精确的 ${order.usdt?.amount || ''} USDT。转错链或少一分都无法自动确认。到账确认可能需要几分钟，请留在本页，也可稍后凭商户单号查单。支付完成后页面会自动展示卡密。`;
  }
  if (order.paymentMethod === 'epay_wxpay' || name === '微信') {
    return `请使用微信扫描上方二维码完成「${name}」支付。支付完成后页面会自动展示卡密。也可凭商户单号到「查单」查看。`;
  }
  if (order.paymentMethod === 'epay_qqpay' || name === 'QQ钱包') {
    return `请使用 QQ 钱包扫描上方二维码完成「${name}」支付。支付完成后页面会自动展示卡密。也可凭商户单号到「查单」查看。`;
  }
  return `请使用对应应用扫描上方二维码完成「${name}」支付。支付完成后页面会自动展示卡密。也可凭商户单号到「查单」查看。`;
}

function payTitle(order: PayOrder): string {
  const name = order.payMethod || '支付宝';
  if (isUsdtPay(order)) return `${name} 转账`;
  return `${name}扫码支付`;
}

function startButtonLabel(methods: PayMethod[], selected?: string): string {
  const current = methods.find((m) => m.id === selected) || methods[0];
  const name = current?.label || '支付宝';
  return `生成${name}收款码`;
}

export default function PayPage() {
  const cart = useCart();
  const nav = useNavigate();
  const { message } = App.useApp();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState<PayOrder | null>(null);
  const [paid, setPaid] = useState(false);
  const [paidOrder, setPaidOrder] = useState<PublicOrder | null>(null);
  const [payError, setPayError] = useState('');
  const [httpHint, setHttpHint] = useState(
    isInsecurePublicHttp() ? HTTP_PAY_HINT : '',
  );
  const [methods, setMethods] = useState<PayMethod[] | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<string>('');
  const cleared = useRef(false);

  useEffect(() => {
    api
      .getStorePayment()
      .then((res) => {
        const list = res.methods?.length
          ? res.methods
          : res.alipayConfigured
            ? [{ id: 'alipay_f2f', label: '支付宝' }]
            : [];
        setMethods(list);
        setSelectedMethod((prev) => prev || list[0]?.id || '');
        if (res.insecureHttp && res.hint) setHttpHint(res.hint);
        else if (res.insecureHttp) setHttpHint(HTTP_PAY_HINT);
      })
      .catch(() => {
        /* 状态查询失败时仍允许点击下单，由下单接口返回明确错误 */
      });
  }, []);

  useEffect(() => {
    if (!order || paid) return;
    const t = setInterval(async () => {
      try {
        const local = await api.queryOrder(order.outTradeNo);
        const st = local.order.status;
        if (st === 'TRADE_SUCCESS' || st === 'TRADE_FINISHED' || st === 'SUCCESS') {
          setPaidOrder(local.order);
          setPaid(true);
          if (!cleared.current) {
            cleared.current = true;
            cart.clear();
          }
          return;
        }
        if (st === 'TRADE_CLOSED' || st === 'FAILED') {
          setPayError(
            st === 'TRADE_CLOSED'
              ? '订单已关闭或已过期，请重新下单。'
              : '支付失败，请重新下单或联系商家。',
          );
          setOrder(null);
        }
      } catch {
        /* ignore poll errors */
      }
    }, 2500);
    return () => clearInterval(t);
  }, [order, paid, cart]);

  async function startPay() {
    if (!cart.items.length) {
      message.warning('购物车为空');
      nav('/cart');
      return;
    }
    const paymentMethod =
      selectedMethod || (methods && methods.length === 1 ? methods[0].id : '');
    if (methods && methods.length > 1 && !paymentMethod) {
      message.warning('请选择支付方式');
      return;
    }
    setPayError('');
    setBusy(true);
    try {
      const res = await api.checkout({
        items: cart.items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
        })),
        buyerNote: note.trim() || undefined,
        paymentMethod: paymentMethod || undefined,
      });
      const qrCode = res.order?.qrCode?.trim() || res.order?.usdt?.qrContent?.trim() || '';
      const payUrl = res.order?.payUrl?.trim() || res.order?.usdt?.paymentUrl?.trim() || '';
      const payScheme = res.order?.payScheme?.trim() || '';
      if (!qrCode && !payUrl && !payScheme && !res.order?.usdt?.address) {
        throw new Error('未能生成收款码，请稍后重试或联系商家');
      }
      setOrder({
        outTradeNo: res.order.outTradeNo,
        totalAmount: res.order.totalAmount,
        subject: res.order.subject,
        qrCode: qrCode || payUrl || payScheme || res.order.usdt?.qrContent || res.order.usdt?.address || '',
        payUrl: payUrl || undefined,
        payScheme: payScheme || undefined,
        payMethod: res.order.payMethod,
        paymentMethod: res.order.paymentMethod,
        status: res.order.status,
        usdt: res.order.usdt,
      });
      message.success(
        (res.order.paymentMethod || '').startsWith('usdt_')
          ? `请按显示的精确金额完成${res.order.payMethod || 'USDT'}转账`
          : `已生成收款码，请使用${res.order.payMethod || '支付宝'}扫码`,
      );
    } catch (e) {
      const text = errorText(e);
      setPayError(text);
      message.error(text);
    } finally {
      setBusy(false);
    }
  }

  if (paid && order) {
    const view = paidOrder;
    const pending = view?.fulfillmentStatus === 'pending_fulfillment';
    return (
      <Card className="glass-card">
        <Result
          status={pending ? 'warning' : 'success'}
          title={pending ? '支付成功，商家将为您补发卡密' : '支付成功啦 ✧'}
          subTitle={`商户单号 ${order.outTradeNo} · ¥${order.totalAmount}。请妥善保存卡密，也可稍后通过查单再次查看。`}
        />
        <DeliveredKeys
          keys={view?.keys ?? []}
          pending={pending}
          messageText={view?.message}
        />
        <Space style={{ marginTop: 20, width: '100%', justifyContent: 'center' }} wrap>
          <Link to={`/order?no=${encodeURIComponent(order.outTradeNo)}`}>
            <Button>查单</Button>
          </Link>
          <Link to="/">
            <Button type="primary" className="candy-btn">
              回首页
            </Button>
          </Link>
        </Space>
      </Card>
    );
  }

  if (order?.qrCode || order?.usdt) {
    const qrValue = order.qrCode || order.usdt?.qrContent || order.usdt?.address || '';
    return (
      <Card className="glass-card pay-qr-card">
        <Typography.Title level={3} style={{ textAlign: 'center' }}>
          {payTitle(order)}
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ textAlign: 'center' }}>
          {order.subject} · ¥{order.totalAmount}
          {order.usdt?.amount ? ` · ${order.usdt.amount} USDT` : ''}
        </Typography.Paragraph>
        {qrValue ? (
          <div className="qr-panel cute">
            <QRCodeSVG value={qrValue} size={220} includeMargin />
            <Spin tip="等待支付中…" />
            <div className="mono">{order.outTradeNo}</div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', margin: '16px 0' }}>
            <Spin tip="等待支付中…" />
            <div className="mono">{order.outTradeNo}</div>
          </div>
        )}
        {order.usdt && (
          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <Typography.Paragraph style={{ marginBottom: 8, fontWeight: 600 }}>
              网络：{order.usdt.network || 'USDT'}
            </Typography.Paragraph>
            <Typography.Paragraph type="warning" style={{ marginBottom: 8 }}>
              请只在「{order.usdt.network || '该网络'}」转账，转到其他链将无法到账发卡。
            </Typography.Paragraph>
            <Typography.Paragraph copyable={{ text: order.usdt.address }} className="mono">
              {order.usdt.address}
            </Typography.Paragraph>
            <Typography.Paragraph copyable={{ text: order.usdt.amount }} style={{ fontSize: 20, marginBottom: 4 }}>
              {order.usdt.amount} USDT
            </Typography.Paragraph>
            {order.usdt.expireAt && (
              <Typography.Paragraph type="secondary">
                请在 {new Date(order.usdt.expireAt).toLocaleString()} 前完成转账
              </Typography.Paragraph>
            )}
          </div>
        )}
        <Alert
          type="info"
          showIcon
          style={{ marginTop: 16 }}
          message={scanHint(order)}
        />
        {(order.payUrl || order.payScheme || order.usdt?.paymentUrl) && (
          <div style={{ textAlign: 'center', marginTop: 12 }}>
            <Button
              type="primary"
              className="candy-btn"
              href={order.payUrl || order.payScheme || order.usdt?.paymentUrl}
              target="_blank"
              rel="noreferrer"
            >
              打开支付页
            </Button>
          </div>
        )}
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <Link to={`/order?no=${encodeURIComponent(order.outTradeNo)}`}>打开查单</Link>
        </div>
      </Card>
    );
  }

  const ready = methods === null ? null : methods.length > 0;
  const showChooser = (methods?.length ?? 0) > 1;

  return (
    <Card className="glass-card">
      <Typography.Title level={3}>确认订单 💖</Typography.Title>
      {!cart.items.length ? (
        <Alert
          type="warning"
          message="购物车为空"
          action={
            <Link to="/">
              <Button size="small">去选购</Button>
            </Link>
          }
        />
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {cart.items.map((it) => (
            <div key={it.productId} className="checkout-line">
              <span>
                {it.name} × {it.quantity}
              </span>
              <span className="price">
                ¥{(Number(it.price) * it.quantity).toFixed(2)}
              </span>
            </div>
          ))}
          <div className="checkout-line total">
            <span>应付</span>
            <span className="price big">¥{cart.total.toFixed(2)}</span>
          </div>
          <Input.TextArea
            rows={2}
            maxLength={200}
            placeholder="备注（可选）"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {ready === false && (
            <Alert
              type="warning"
              showIcon
              message="商家暂未开通在线支付，请稍后再试或联系商家"
            />
          )}
          {showChooser && methods && (
            <div>
              <Typography.Text style={{ display: 'block', marginBottom: 8 }}>
                选择支付方式
              </Typography.Text>
              <Radio.Group
                value={selectedMethod}
                onChange={(e) => setSelectedMethod(e.target.value)}
                optionType="button"
                buttonStyle="solid"
                options={methods.map((m) => ({ value: m.id, label: m.label }))}
              />
            </div>
          )}
          {httpHint && !(selectedMethod || '').startsWith('usdt_') && (
            <Alert type="warning" showIcon message={httpHint} />
          )}
          {payError && (
            <Alert type="error" showIcon message={payError} />
          )}
          {!httpHint && ready !== false && !payError && (
            <Alert
              type="info"
              showIcon
              message={
                showChooser
                  ? '请选择支付方式并生成收款码，使用对应应用扫码完成付款。'
                  : `请使用${methods?.[0]?.label || '支付宝'}扫码完成支付。点击下方按钮生成收款码。`
              }
            />
          )}
          <Button
            type="primary"
            size="large"
            block
            className="candy-btn"
            loading={busy}
            disabled={ready === false}
            onClick={() => void startPay()}
          >
            {methods && methods.length
              ? startButtonLabel(methods, selectedMethod)
              : '生成支付宝收款码'}
          </Button>
        </Space>
      )}
    </Card>
  );
}
