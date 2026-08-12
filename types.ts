import { Timestamp } from "firebase/firestore";

export interface BaseDoc {
  id: string;
  createdAt?: Timestamp | Date | string;
  updatedAt?: Timestamp | Date | string;
  isVoided?: boolean;
}

export interface AppUser extends BaseDoc {
  uid: string;
  email: string;
  name: string;
  role: "admin" | "user";
  permissions: string[];
}

export interface Product extends BaseDoc {
  name: string;
  code: string;
  categoryId: string;
  categoryName?: string;
  quantityPerCarton: number;
  minCartonAlert: number;
  photoUrl?: string;
  photoUrls?: string[];
  barcodeValue: string;
  voucherId: string;
  description?: string;
}

export interface Category extends BaseDoc {
  name: string;
  description?: string;
}

export interface Store extends BaseDoc {
  name: string;
  level: string;
  address: string;
  voucherId: string;
}

export interface Supplier extends BaseDoc {
  name: string;
  address: string;
  phone: string;
  totalPaid: number;
  totalBalance: number;
  photoProofUrl?: string;
  beginningBalance?: number;
  beginningDate?: string;
  beginningPaid?: number;
  beginningPaidDate?: string;
}

export interface Customer extends BaseDoc {
  name: string;
  address: string;
  phone: string;
  totalPaid: number;
  totalBalance: number;
  voucherId: string;
  beginningBalance?: number;
  beginningDate?: string;
  beginningNote?: string;
  beginningPhotoUrl?: string;
}

export interface StockInItem {
  productId: string;
  productName: string;
  productCode: string;
  quantityPerCarton: number;
  cartonsReceived: number;
  unitPrice: number;
  cartonPrice: number;
  totalPrice: number;
  photoUrl?: string;
}

export interface StockIn extends BaseDoc {
  voucherId: string;
  supplierId: string;
  supplierName: string;
  storeId: string;
  storeName: string;
  categoryId?: string;
  categoryName?: string;
  items: StockInItem[];
  totalCartons: number;
  totalPrice: number;
  amountPaid: number;
  remainingBalance: number;
  fsNumber?: string;
  remark?: string;
  photoProofUrl?: string;
  voucherDate?: string;
  status: "active" | "voided";
  createdByName?: string;
  updatedByName?: string;
}

export interface PricingRecord extends BaseDoc {
  productId: string;
  productName: string;
  productCode: string;
  unitCost: number;
  profitMargin: number;
  sellingPrice: number;
  ecommercePiecePrice?: number;
}

export interface SaleItem {
  productId: string;
  productName: string;
  productCode: string;
  quantityPerCarton: number;
  photoUrl?: string;
  remainingStock: number;
  sellingPrice: number;
  adjustedPrice: number;
  sellByCarton: boolean;
  quantity: number;
  totalPrice: number;
}

export interface PosSale extends BaseDoc {
  voucherId: string;
  customerId?: string;
  customerName?: string;
  storeId: string;
  storeName: string;
  items: SaleItem[];
  subtotal: number;
  totalAmount: number;
  paymentMethod: "cash" | "transfer" | "credit";
  transferType?: "supplier" | "account";
  supplierId?: string;
  supplierName?: string;
  accountId?: string;
  accountName?: string;
  accountBankName?: string;
  accountPersonName?: string;
  accountNumber?: string;
  fsNumber?: string;
  amountPaid: number;
  remainingBalance: number;
  remark?: string;
  photoProofUrl?: string;
  voucherDate?: string;
  status: "active" | "voided";
  createdByName?: string;
  updatedByName?: string;
}

export interface EcommerceOrder extends BaseDoc {
  orderVoucherId: string;
  customerId?: string;
  customerName: string;
  customerPhone?: string;
  customerAddress?: string;
  items: Array<{
    productId: string;
    productName: string;
    productCode: string;
    photoUrl?: string;
    price: number;
    quantity: number;
    totalPrice: number;
  }>;
  totalAmount: number;
  status: "pending" | "approved" | "denied" | "converted";
  storeId?: string;
}

export interface TransferItem {
  productId: string;
  productName: string;
  productCode: string;
  photoUrl?: string;
  quantityPerCarton: number;
  availableQty: number;
  price: number;
  quantity: number;
  sellByCarton?: boolean;
}

export interface Transfer extends BaseDoc {
  voucherId: string;
  fromStoreId: string;
  fromStoreName: string;
  toStoreId: string;
  toStoreName: string;
  items: TransferItem[];
  voucherDate?: string;
  status: "active" | "voided";
  createdByName?: string;
  updatedByName?: string;
}

export interface DamageReturnItem {
  productId: string;
  productName: string;
  productCode: string;
  sellBySingle: boolean;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  reason?: string;
}

export interface DamageReturn extends BaseDoc {
  voucherId: string;
  storeId: string;
  storeName: string;
  type: "damage" | "return";
  items: DamageReturnItem[];
  totalAmount: number;
  voucherDate?: string;
  status: "active" | "voided";
  createdByName?: string;
  updatedByName?: string;
}

export interface Expense extends BaseDoc {
  voucherId: string;
  storeId?: string;
  storeName?: string;
  type: "product" | "general";
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    isByCarton?: boolean;
  }>;
  totalAmount: number;
  remark?: string;
  status: "active" | "voided";
  createdByName?: string;
  updatedByName?: string;
}

export interface StoreBalance {
  storeId: string;
  storeName: string;
  productId: string;
  productName: string;
  productCode: string;
  photoUrl?: string;
  quantity: number;
  unitPrice?: number;
}

export interface BincardEntry {
  date: string;
  type: "stock_in" | "sale" | "transfer_in" | "transfer_out" | "damage" | "return";
  voucherId: string;
  storeId: string;
  storeName: string;
  quantity: number;
  balance: number;
  remark?: string;
}

export interface ProductRequest extends BaseDoc {
  voucherId: string;
  requestingStoreId: string;
  requestingStoreName: string;
  sourceStoreId: string;
  sourceStoreName: string;
  items: Array<{
    productId: string;
    productName: string;
    productCode: string;
    requestedQty: number;
    availableQty: number;
  }>;
  status: "pending" | "approved" | "denied";
}

export interface StoreRequest extends BaseDoc {
  voucherId: string;
  fromStoreId: string;
  fromStoreName: string;
  toStoreId: string;
  toStoreName: string;
  items: StoreRequestItem[];
  status: "pending" | "approved" | "received" | "voided";
  approvedBy?: string;
  approvedAt?: Timestamp | Date | string;
  receivedBy?: string;
  receivedAt?: Timestamp | Date | string;
  remark?: string;
  voucherDate?: string;
  createdByName?: string;
}

export interface StoreRequestItem {
  productId: string;
  productName: string;
  productCode: string;
  photoUrl?: string;
  categoryName?: string;
  quantityPerCarton: number;
  availableQtyFrom: number;
  availableQtyTo: number;
  price: number;
  quantity: number;
  sellByCarton: boolean;
}

export interface Account extends BaseDoc {
  bankName: string;
  personName: string;
  accountNumber: string;
  totalDeposit: number;
  totalWithdraw: number;
  balance: number;
}

export interface AccountVoucher extends BaseDoc {
  voucherId: string;
  accountId: string;
  accountBankName: string;
  accountPersonName: string;
  accountNumber: string;
  type: "deposit" | "withdraw";
  amount: number;
  fsNumber?: string;
  customerName?: string;
  reason?: string;
  date?: string;
  photoProofUrl?: string;
  note?: string;
  remark?: string;
  isVoided?: boolean;
  createdByName?: string;
  updatedByName?: string;
  supplierId?: string;
  supplierName?: string;
}

export interface Promotion extends BaseDoc {
  title: string;
  description?: string;
  link?: string;
  photoUrl?: string;
  videoUrl?: string;
  productIds: string[];
  productNames: string[];
  isActive: boolean;
  showBanner: boolean;
  showPopup: boolean;
  showHighlight: boolean;
  showVideo?: boolean;
  displaySeconds?: number;
}

export interface BinningItem {
  productId: string;
  productName: string;
  productCode: string;
  photoUrl?: string;
  quantityPerCarton: number;
  cartons: number;
  units: number;
  unitPrice: number;
  cartonPrice: number;
}

export interface BinningVoucher extends BaseDoc {
  voucherId: string;
  storeId: string;
  storeName: string;
  items: BinningItem[];
  totalCartons: number;
  totalUnits: number;
  status: "draft" | "approved" | "voided";
  remark?: string;
  approvedAt?: string;
  approvedBy?: string;
  stockInId?: string;
  createdByName?: string;
}

export interface DirectSaleItem {
  productId: string;
  productName: string;
  productCode: string;
  photoUrl?: string;
  quantityPerCarton: number;
  quantity: number;
  sellByCarton: boolean;
  unitPrice: number;
  totalPrice: number;
}

export interface DirectSale extends BaseDoc {
  voucherId: string;
  storeId: string;
  storeName: string;
  soldByName: string;
  items: DirectSaleItem[];
  totalAmount: number;
  remark?: string;
  status: "active" | "approved" | "voided";
  approvedBy?: string;
  approvedAt?: Timestamp | Date | string;
  posVoucherId?: string;
  createdByName?: string;
  updatedByName?: string;
}

export interface AppSettings extends BaseDoc {
  ecommerceLogo?: string;
  ecommerceName?: string;
  ecommerceTagline?: string;
  ecommerceHeroText?: string;
  ecommerceFooterText?: string;
  ecommerceUsername?: string;
  ecommercePassword?: string;
  primaryColor?: string;
  fontStyle?: string;
  menuStyle?: "horizontal" | "sidebar";
}

export interface InventorySystem extends BaseDoc {
  name: string;
  adminEmail: string;
  createdAt: string;
  createdBy: string;
}

export interface SupplierPayment extends BaseDoc {
  supplierId: string;
  supplierName: string;
  stockInVoucherId?: string;
  amountPaid: number;
  remainingBalance: number;
  photoProofUrl?: string;
  fsNumber?: string;
  note?: string;
  paymentDate?: string;
  voided?: boolean;
}

export interface CustomerPayment extends BaseDoc {
  customerId: string;
  customerName: string;
  saleVoucherId?: string;
  amountPaid: number;
  remainingBalance: number;
  photoProofUrl?: string;
  fsNumber?: string;
  note?: string;
  paymentDate?: string;
  payVia?: "none" | "supplier" | "account";
  supplierId?: string;
  supplierName?: string;
  accountId?: string;
  accountName?: string;
  accountNumber?: string;
  voided?: boolean;
}
