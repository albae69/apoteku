CREATE TABLE `shifts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`status` enum('open','closed') NOT NULL DEFAULT 'open',
	`opened_at` timestamp NOT NULL DEFAULT (now()),
	`closed_at` timestamp,
	`opening_cash` decimal(14,2) NOT NULL DEFAULT 0,
	`closing_cash` decimal(14,2),
	`expected_cash` decimal(14,2),
	`difference` decimal(14,2),
	`total_sales` decimal(14,2) NOT NULL DEFAULT 0,
	`total_cash` decimal(14,2) NOT NULL DEFAULT 0,
	`total_non_cash` decimal(14,2) NOT NULL DEFAULT 0,
	`transaction_count` int NOT NULL DEFAULT 0,
	`note` varchar(500),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `shifts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `sales` ADD `shift_id` int;--> statement-breakpoint
ALTER TABLE `shifts` ADD CONSTRAINT `shifts_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `shifts_user_idx` ON `shifts` (`user_id`);--> statement-breakpoint
CREATE INDEX `shifts_status_idx` ON `shifts` (`status`);--> statement-breakpoint
ALTER TABLE `sales` ADD CONSTRAINT `sales_shift_id_shifts_id_fk` FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON DELETE set null ON UPDATE no action;