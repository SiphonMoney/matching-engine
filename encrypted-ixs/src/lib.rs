use arcis_imports::*;

#[encrypted]
mod circuits {
    use arcis_imports::*;

    pub const MAX_ORDERS: usize = 4;
    pub const MAX_MATCHES_PER_BATCH: usize = 4;

    #[derive(Copy, Clone)]
    pub struct Order {
        pub order_id: u64,  // 8
        pub amount: u64,    // 8
        pub price: u64,     // 8
        pub order_type: u8, // 1
        pub timestamp: u64, // 8
    }

    #[derive(Copy, Clone)]
    pub struct OrderStatus {
        pub order_type: u8,
        pub amount: u64,
        pub price: u64,
        pub status: u8,
        pub locked_amount: u64,
        pub filled_amount: u64,
        pub execution_price: u64,
    }
    #[derive(Copy, Clone)]
    pub struct Balances {
        pub base_total: u64,
        pub base_available: u64,
        pub quote_total: u64,
        pub quote_available: u64,
    }

    impl Order {
        pub fn empty() -> Self {
            Order {
                order_id: 0,
                amount: 0,
                price: 0,
                order_type: 0,
                timestamp: 0,
            }
        }

        pub fn is_buy(&self) -> bool {
            self.order_type == 0
        }

        pub fn is_sell(&self) -> bool {
            self.order_type == 1
        }
    }
    #[derive(Copy, Clone)]
    pub struct OrderBook {
        pub buy_orders: [Order; MAX_ORDERS],
        pub buy_count: u8,
        pub sell_orders: [Order; MAX_ORDERS],
        pub sell_count: u8,
    }

    impl OrderBook {
        pub fn new() -> Self {
            OrderBook {
                buy_orders: [Order::empty(); MAX_ORDERS],
                buy_count: 0,
                sell_orders: [Order::empty(); MAX_ORDERS],
                sell_count: 0,
            }
        }

        pub fn insert_buy(&mut self, order: Order) -> bool {
            let success = if self.buy_count >= MAX_ORDERS as u8 {
                false
            } else {
                self.buy_orders[self.buy_count as usize] = order;
                self.buy_count += 1;

                let mut i = self.buy_count - 1;
                let mut done = false;
                for _ in 0..MAX_ORDERS {
                    if i == 0 || done {
                        done = true;
                    } else {
                        let parent = (i - 1) / 2;
                        if self.compare_buy(i as usize, parent as usize) {
                            self.buy_orders.swap(i as usize, parent as usize);
                            i = parent;
                        } else {
                            done = true;
                        }
                    }
                }

                true
            };
            success
        }

        pub fn insert_sell(&mut self, order: Order) -> bool {
            let success = if self.sell_count >= MAX_ORDERS as u8 {
                false
            } else {
                self.sell_orders[self.sell_count as usize] = order;
                self.sell_count += 1;

                let mut i = self.sell_count - 1;
                let mut done = false;
                for _ in 0..MAX_ORDERS {
                    if i == 0 || done {
                        done = true;
                    } else {
                        let parent = (i - 1) / 2;
                        if self.compare_sell(i as usize, parent as usize) {
                            self.sell_orders.swap(i as usize, parent as usize);
                            i = parent;
                        } else {
                            done = true;
                        }
                    }
                }

                true
            };
            success
        }

        fn compare_buy(&self, i: usize, j: usize) -> bool {
            let a = &self.buy_orders[i];
            let b = &self.buy_orders[j];

            if a.price != b.price {
                a.price > b.price
            } else {
                a.timestamp < b.timestamp
            }
        }

        fn compare_sell(&self, i: usize, j: usize) -> bool {
            let a = &self.sell_orders[i];
            let b = &self.sell_orders[j];

            if a.price != b.price {
                a.price < b.price
            } else {
                a.timestamp < b.timestamp
            }
        }

        fn heapify_buy(&mut self, mut i: usize) {
            let mut done = false;
            for _ in 0..MAX_ORDERS {
                if done {
                    // continue
                } else {
                    let left = 2 * i + 1;
                    let right = 2 * i + 2;
                    let mut largest = i;

                    if left < self.buy_count as usize && self.compare_buy(left, largest) {
                        largest = left;
                    }

                    if right < self.buy_count as usize && self.compare_buy(right, largest) {
                        largest = right;
                    }

                    if largest != i {
                        self.buy_orders.swap(i, largest);
                        i = largest;
                    } else {
                        done = true;
                    }
                }
            }
        }

        fn heapify_sell(&mut self, mut i: usize) {
            let mut done = false;
            for _ in 0..MAX_ORDERS {
                if done {
                    // continue
                } else {
                    let left = 2 * i + 1;
                    let right = 2 * i + 2;
                    let mut smallest = i;

                    if left < self.sell_count as usize && self.compare_sell(left, smallest) {
                        smallest = left;
                    }

                    if right < self.sell_count as usize && self.compare_sell(right, smallest) {
                        smallest = right;
                    }

                    if smallest != i {
                        self.sell_orders.swap(i, smallest);
                        i = smallest;
                    } else {
                        done = true;
                    }
                }
            }
        }

        pub fn pop_buy(&mut self) -> Order {
            let order = self.buy_orders[0];
            self.buy_count -= 1;

            if self.buy_count > 0 {
                self.buy_orders[0] = self.buy_orders[self.buy_count as usize];
                self.heapify_buy(0);
            }

            order
        }

        pub fn pop_sell(&mut self) -> Order {
            let order = self.sell_orders[0];
            self.sell_count -= 1;

            if self.sell_count > 0 {
                self.sell_orders[0] = self.sell_orders[self.sell_count as usize];
                self.heapify_sell(0);
            }

            order
        }

        pub fn peek_buy(&self) -> Order {
            self.buy_orders[0]
        }

        pub fn peek_sell(&self) -> Order {
            self.sell_orders[0]
        }

        pub fn has_buy(&self) -> bool {
            self.buy_count > 0
        }

        pub fn has_sell(&self) -> bool {
            self.sell_count > 0
        }
    }

    #[derive(Copy, Clone)]
    pub struct MatchedOrder {
        pub match_id: u64,
        pub buyer_order_id: u64,
        pub seller_order_id: u64,
        pub quantity: u64,
        pub execution_price: u64,
    }

    impl MatchedOrder {
        pub fn empty() -> Self {
            MatchedOrder {
                match_id: 0,
                buyer_order_id: 0,
                seller_order_id: 0,
                quantity: 0,
                execution_price: 0,
            }
        }
    }

    pub struct MatchResult {
        pub matches: [MatchedOrder; MAX_MATCHES_PER_BATCH],
        pub num_matches: u8,
    }

    impl MatchResult {
        pub fn empty() -> Self {
            MatchResult {
                matches: [MatchedOrder::empty(); MAX_MATCHES_PER_BATCH],
                num_matches: 0,
            }
        }

        // Helper to set matches one at a time
        pub fn set_match(&mut self, index: u8, matched_order: MatchedOrder) {
            for i in 0..MAX_MATCHES_PER_BATCH {
                if i == index as usize {
                    self.matches[i] = matched_order;
                }
            }
        }
    }

    #[instruction]
    pub fn init_order_book(mxe: Mxe) -> Enc<Mxe, OrderBook> {
        let order_book = OrderBook::new();
        mxe.from_arcis(order_book)
    }

    #[instruction]
    pub fn init_user_ledger(user: Shared) -> Enc<Shared, Balances> {
        let balances = Balances {
            base_total: 0,
            base_available: 0,
            quote_total: 0,
            quote_available: 0,
        };
        user.from_arcis(balances)
    }
    pub struct UserSensitiveData {
        pub amount: u64,
        pub price: u64,
    }


    #[instruction]
    pub fn submit_order(
        user_sensitive: Enc<Shared, UserSensitiveData>, // User's x25519
        user_ledger: Enc<Mxe, &Balances>,               // MXE
        orderbook_ctx: Enc<Mxe, &OrderBook>,            // MXE
        order_id: u64,
        order_type: u8,
        timestamp: u64,
    ) -> (
        Enc<Mxe, OrderBook>,      // Updated orderbook
        Enc<Mxe, Balances>,       // Updated ledger
        Enc<Shared, OrderStatus>, // For user to view
        bool,                     // Success
    ) {
        let sensitive = user_sensitive.to_arcis();
        let mut ledger = *(user_ledger.to_arcis());
        let mut orderbook = *(orderbook_ctx.to_arcis());

        // Calculate required amount
        let required = if order_type == 0 {
            // Buy order needs quote token
            sensitive.amount * sensitive.price
        } else {
            // Sell order needs base token
            sensitive.amount
        };

        // Check available balance
        let available = if order_type == 0 {
            ledger.quote_available
        } else {
            ledger.base_available
        };

        let mut possible = true;

        if available < required {
            // Insufficient balance
            possible = false;
        }

        // Lock funds
        if order_type == 0 {
            ledger.quote_available -= required;
            // Note: We don't track locked separately in this simplified version
            // In production, you'd have base_locked and quote_locked fields
        } else {
            ledger.base_available -= required;
        }

        // Add to orderbook

        let order = if possible {
            Order {
                order_id,
                amount: sensitive.amount,
                price: sensitive.price,
                order_type,
                timestamp,
            }
        } else {
            Order::empty()
        };

        let success = if possible {
            if order_type == 0 {
                orderbook.insert_buy(order)
            } else {
                orderbook.insert_sell(order)
            }
        } else {
            false
        };

        let status = if possible {
            OrderStatus {
                order_type,
                amount: sensitive.amount,
                price: sensitive.price,
                status: if success { 1 } else { 2 }, // 1=processing, 2=rejected
                locked_amount: if success { required } else { 0 },
                filled_amount: 0,
                execution_price: 0,
            }
        } else {
            OrderStatus {
                order_type,
                amount: sensitive.amount,
                price: sensitive.price,
                status: 5, // Status = 5: Insufficient balance
                locked_amount: 0,
                filled_amount: 0,
                execution_price: 0,
            }
        };

        (
            orderbook_ctx.owner.from_arcis(orderbook),
            user_ledger.owner.from_arcis(ledger),
            user_sensitive.owner.from_arcis(status),
            success.reveal(),
        )
    }

    #[instruction]
    pub fn match_orders(
        clanker_authority: Shared,
        order_book_ctxt: Enc<Mxe, &OrderBook>,
    ) -> (Enc<Mxe, OrderBook>, Enc<Shared, MatchResult>, u8) {
        let mut order_book = *(order_book_ctxt.to_arcis());
        let mut result = MatchResult::empty();

        let mut match_count = 0u8;
        let mut next_match_id = 0u64;

        for match_idx in 0..MAX_MATCHES_PER_BATCH {
            if order_book.has_buy() && order_book.has_sell() {
                let buy = order_book.peek_buy();
                let sell = order_book.peek_sell();

                if buy.price >= sell.price {
                    let mut buyer = order_book.pop_buy();
                    let mut seller = order_book.pop_sell();

                    let execution_price = (buyer.price + seller.price) / 2;
                    let fill_quantity = if buyer.amount < seller.amount {
                        buyer.amount
                    } else {
                        seller.amount
                    };

                    result.set_match(
                        match_idx as u8,
                        MatchedOrder {
                            match_id: next_match_id,
                            buyer_order_id: buyer.order_id,
                            seller_order_id: seller.order_id,
                            quantity: fill_quantity,
                            execution_price,
                        },
                    );

                    buyer.amount = buyer.amount - fill_quantity;
                    seller.amount = seller.amount - fill_quantity;

                    if buyer.amount > 0 {
                        order_book.insert_buy(buyer);
                    }

                    if seller.amount > 0 {
                        order_book.insert_sell(seller);
                    }

                    match_count = match_idx as u8 + 1;
                    next_match_id += 1;
                }
            }
        }

        result.num_matches = match_count;

        (
            order_book_ctxt.owner.from_arcis(order_book),
            clanker_authority.from_arcis(result),
            match_count.reveal(),
        )
    }

    #[instruction]
    pub fn update_ledger_deposit(
        ledger_ctx: Enc<Shared, &Balances>, // Current encrypted balances
        amount: u64,
        is_base: u8,
    ) -> Enc<Shared, Balances> {
        let mut balances = *(ledger_ctx.to_arcis());

        if is_base == 0 {
            // Deposit base token
            balances.base_total += amount;
            balances.base_available += amount;
        } else {
            // Deposit quote token
            balances.quote_total += amount;
            balances.quote_available += amount;
        }

        ledger_ctx.owner.from_arcis(balances)
    }


    #[instruction]
    pub fn update_ledger_withdraw_verify(
        ledger: Enc<Shared, Balances>,
        amount: u64,
        is_base: u8,
    ) -> (Enc<Shared, Balances>, bool) {
        let mut balances = ledger.to_arcis();

        let available = if is_base == 0 {
            balances.base_available
        } else {
            balances.quote_available
        };

        let mut possible = false;

        if available >= amount {
            // Insufficient balance
            possible = true;
            if is_base == 0 {
                balances.base_total -= amount;
                balances.base_available -= amount;
            } else {
                balances.quote_total -= amount;
                balances.quote_available -= amount;
            }
        }

        (ledger.owner.from_arcis(balances), possible.reveal())
    }
}
