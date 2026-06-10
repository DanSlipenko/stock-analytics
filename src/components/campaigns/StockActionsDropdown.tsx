"use client";

import { Modal } from "antd";
import { Bell, MoreHorizontal, Pencil, ShoppingCart, Trash2, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type StockActionsDropdownProps = {
  hasRemaining: boolean;
  showAlerts?: boolean;
  onSell: () => void;
  onBuyMore: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAlerts?: () => void;
  stopPropagation?: boolean;
};

export default function StockActionsDropdown({
  hasRemaining,
  showAlerts = false,
  onSell,
  onBuyMore,
  onEdit,
  onDelete,
  onAlerts,
  stopPropagation = false,
}: StockActionsDropdownProps) {
  const confirmDelete = () => {
    Modal.confirm({
      title: "Remove this stock?",
      okText: "Remove",
      okType: "danger",
      cancelText: "Cancel",
      onOk: onDelete,
    });
  };

  const wrapperProps = stopPropagation ?
    {
      onClick: (event: React.MouseEvent) => event.stopPropagation(),
      onKeyDown: (event: React.KeyboardEvent) => event.stopPropagation(),
    }
  : {};

  return (
    <div {...wrapperProps}>
      <DropdownMenu>
        <DropdownMenuTrigger>
          <Button variant="ghost" size="icon-sm" aria-label="Stock actions">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {showAlerts && onAlerts && (
            <DropdownMenuItem onSelect={onAlerts}>
              <Bell />
              Alerts
            </DropdownMenuItem>
          )}
          {hasRemaining && (
            <DropdownMenuItem onSelect={onSell}>
              <TrendingDown />
              Sell
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={onBuyMore}>
            <ShoppingCart />
            Buy More
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil />
            Edit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={confirmDelete}>
            <Trash2 />
            Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
