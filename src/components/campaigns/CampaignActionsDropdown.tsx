"use client";

import { Modal } from "antd";
import { CircleCheck, Eye, EyeOff, MoreVertical, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type CampaignActionsDropdownProps = {
  campaignName: string;
  collapsed: boolean;
  closed: boolean;
  onEdit: () => void;
  onToggleCollapsed: () => void;
  onToggleClosed: () => void;
  onDelete: () => void;
};

export default function CampaignActionsDropdown({
  campaignName,
  collapsed,
  closed,
  onEdit,
  onToggleCollapsed,
  onToggleClosed,
  onDelete,
}: CampaignActionsDropdownProps) {
  const confirmDelete = () => {
    Modal.confirm({
      title: "Delete this campaign?",
      content: `All stocks and transactions in "${campaignName}" will be removed.`,
      okText: "Delete",
      okType: "danger",
      cancelText: "Cancel",
      onOk: onDelete,
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${campaignName}`}>
          <MoreVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onToggleCollapsed}>
          {collapsed ?
            <Eye />
          : <EyeOff />}
          {collapsed ? "Show" : "Hide"}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onToggleClosed}>
          {closed ?
            <RotateCcw />
          : <CircleCheck />}
          {closed ? "Reopen" : "Close"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={confirmDelete}>
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
