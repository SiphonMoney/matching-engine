use arcis_imports::*;

#[encrypted]
mod circuits {
    use arcis_imports::*;

    pub const MAX_ORDERS: usize = 4;
    pub const MAX_MATCHES_PER_BATCH: usize = 4;
    pub const POW64: u128 = 18446744073709551616;

    pub const POWS_OF_256: [u128; 8] = [
        1,
        256,
        65536,
        16777216,
        4294967296,
        1099511627776,
        281474976710656,
        72057594037927936,
    ];


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
    // pub
    // in each order there are 4 u64 and a u8
    // so we will store 2u64 in a u128 and after stroing the u64's of all the orders in u128's 
    // for each order we will require  2 u128's in this case we will require MAX_ORDERS * 2 * 2 = 4 * 2 = 8 u128's
    // we will take the reamaining u8's of all the orders and store them in as many u128 we will require
    // in this case that will be MAX_ORDERS * 2 *  8 = 4 * 2 * 8 = 64 so only one u128 will be required
    #[derive(Copy, Clone)]
    pub struct OrderBookFlat {
        pub order_chunk1: u128,
        pub order_chunk2: u128,
        pub order_chunk3: u128,
        pub order_chunk4: u128,
        pub order_chunk5: u128,
        pub order_chunk6: u128,
        pub order_chunk7: u128,
        pub order_chunk8: u128,
        pub order_chunk9: u128,
        pub order_chunk10: u128,
        pub order_chunk11: u128,
        pub order_chunk12: u128,
        pub order_chunk13: u128,
        pub order_chunk14: u128,
        pub order_chunk15: u128,
        pub order_chunk16: u128,
        pub order_type_chunk: u128,
        pub order_count: u128,
    }

    impl OrderBookFlat {
        pub fn new() -> Self {
            OrderBookFlat {
                order_chunk1: 0,
                order_chunk2: 0,
                order_chunk3: 0,
                order_chunk4: 0,
                order_chunk5: 0,
                order_chunk6: 0,
                order_chunk7: 0,
                order_chunk8: 0,
                order_chunk9: 0,
                order_chunk10: 0,
                order_chunk11: 0,
                order_chunk12: 0,
                order_chunk13: 0,
                order_chunk14: 0,
                order_chunk15: 0,
                order_chunk16: 0,
                order_type_chunk: 0,
                order_count: 0,
            }
        }

        pub fn from_orderbook(orderbook: OrderBook) -> Self {
            let mut order_chunk1: u128  = 0;
            let mut order_chunk2: u128 = 0;
            let mut order_chunk3: u128 = 0;
            let mut order_chunk4: u128 = 0;
            let mut order_chunk5: u128 = 0;
            let mut order_chunk6: u128 = 0;
            let mut order_chunk7: u128 = 0;
            let mut order_chunk8: u128 = 0;
            let mut order_chunk9: u128 = 0;
            let mut order_chunk10: u128 = 0;
            let mut order_chunk11: u128 = 0;
            let mut order_chunk12: u128 = 0;
            let mut order_chunk13: u128 = 0;
            let mut order_chunk14: u128 = 0;
            let mut order_chunk15: u128 = 0;
            let mut order_chunk16: u128 = 0;
            let mut order_type_chunk: u128 = 0;
            let mut order_count: u128 = 0;

            order_chunk1 += orderbook.buy_orders[0].order_id as u128;
            order_chunk1 += orderbook.buy_orders[0].amount as u128 * POW64;
            order_chunk2 += orderbook.buy_orders[0].price as u128;
            order_chunk2 += orderbook.buy_orders[0].timestamp as u128 * POW64;

            order_chunk3 +=orderbook.buy_orders[1].order_id as u128;
            order_chunk3 += orderbook.buy_orders[1].amount as u128 * POW64;
            order_chunk4 += orderbook.buy_orders[1].price as u128;
            order_chunk4 += orderbook.buy_orders[1].timestamp as u128 * POW64;  

            order_chunk5 += orderbook.buy_orders[2].order_id as u128;
            order_chunk5 += orderbook.buy_orders[2].amount as u128 * POW64;
            order_chunk6 += orderbook.buy_orders[2].price as u128;
            order_chunk6 += orderbook.buy_orders[2].timestamp as u128 * POW64;  

            order_chunk7 += orderbook.buy_orders[3].order_id as u128;
            order_chunk7 += orderbook.buy_orders[3].amount as u128 * POW64;
            order_chunk8 += orderbook.buy_orders[3].price as u128;
            order_chunk8 += orderbook.buy_orders[3].timestamp as u128 * POW64;  

            order_chunk9 += orderbook.sell_orders[0].order_id as u128;
            order_chunk9 += orderbook.sell_orders[0].amount as u128 * POW64;
            order_chunk10 += orderbook.sell_orders[0].price as u128;
            order_chunk10 += orderbook.sell_orders[0].timestamp as u128 * POW64;  

            order_chunk11 += orderbook.sell_orders[1].order_id as u128;
            order_chunk11 += orderbook.sell_orders[1].amount as u128 * POW64;
            order_chunk12 += orderbook.sell_orders[1].price as u128;
            order_chunk12 += orderbook.sell_orders[1].timestamp as u128 * POW64;  

            order_chunk13 += orderbook.sell_orders[2].order_id as u128;
            order_chunk13 += orderbook.sell_orders[2].amount as u128 * POW64;
            order_chunk14 += orderbook.sell_orders[2].price as u128;
            order_chunk14 += orderbook.sell_orders[2].timestamp as u128 * POW64;  

            order_chunk15 += orderbook.sell_orders[3].order_id as u128;
            order_chunk15 += orderbook.sell_orders[3].amount as u128 * POW64;
            order_chunk16 += orderbook.sell_orders[3].price as u128;
            order_chunk16 += orderbook.sell_orders[3].timestamp as u128 * POW64;  

            order_type_chunk += orderbook.buy_orders[0].order_type as u128 * POWS_OF_256[0];
            order_type_chunk += orderbook.buy_orders[1].order_type as u128 * POWS_OF_256[1];
            order_type_chunk += orderbook.buy_orders[2].order_type as u128 * POWS_OF_256[2]; 
            order_type_chunk += orderbook.buy_orders[3].order_type as u128 * POWS_OF_256[3]; 
            order_type_chunk += orderbook.sell_orders[0].order_type as u128 * POWS_OF_256[4];
            order_type_chunk += orderbook.sell_orders[1].order_type as u128 * POWS_OF_256[5];
            order_type_chunk += orderbook.sell_orders[2].order_type as u128 * POWS_OF_256[6]; 
            order_type_chunk += orderbook.sell_orders[3].order_type as u128 * POWS_OF_256[7]; 

            order_count += orderbook.buy_count as u128;
            order_count += orderbook.sell_count as u128 * 256;

            OrderBookFlat {
                order_chunk1,
                order_chunk2,
                order_chunk3,
                order_chunk4,
                order_chunk5,
                order_chunk6,
                order_chunk7,
                order_chunk8,
                order_chunk9,
                order_chunk10,
                order_chunk11,
                order_chunk12,
                order_chunk13,
                order_chunk14,
                order_chunk15,
                order_chunk16,
                order_type_chunk,
                order_count,
            }
        }
    
        pub fn to_orderbook(self) -> OrderBook {
            let mut orderbook = OrderBook::new();

            orderbook.buy_orders[0].order_id = self.order_chunk1 as u64;
            orderbook.buy_orders[0].amount = (self.order_chunk1 / POW64) as u64;
            orderbook.buy_orders[0].price = (self.order_chunk2 % POW64) as u64;
            orderbook.buy_orders[0].timestamp = (self.order_chunk2 / POW64) as u64;

            orderbook.buy_orders[1].order_id = self.order_chunk3 as u64;
            orderbook.buy_orders[1].amount = (self.order_chunk3 / POW64) as u64;
            orderbook.buy_orders[1].price = (self.order_chunk4 % POW64) as u64;
            orderbook.buy_orders[1].timestamp = (self.order_chunk4 / POW64) as u64;

            orderbook.buy_orders[2].order_id = self.order_chunk5 as u64;
            orderbook.buy_orders[2].amount = (self.order_chunk5 / POW64) as u64;
            orderbook.buy_orders[2].price = (self.order_chunk6 % POW64) as u64;
            orderbook.buy_orders[2].timestamp = (self.order_chunk6 / POW64) as u64;
            
            orderbook.buy_orders[3].order_id = self.order_chunk7 as u64;
            orderbook.buy_orders[3].amount = (self.order_chunk7 / POW64) as u64;
            orderbook.buy_orders[3].price = (self.order_chunk8 % POW64) as u64;
            orderbook.buy_orders[3].timestamp = (self.order_chunk8 / POW64) as u64;

            orderbook.sell_orders[0].order_id = self.order_chunk9 as u64;
            orderbook.sell_orders[0].amount = (self.order_chunk9 / POW64) as u64;
            orderbook.sell_orders[0].price = (self.order_chunk10 % POW64) as u64;
            orderbook.sell_orders[0].timestamp = (self.order_chunk10 / POW64) as u64;

            orderbook.sell_orders[1].order_id = self.order_chunk11 as u64;
            orderbook.sell_orders[1].amount = (self.order_chunk11 / POW64) as u64;
            orderbook.sell_orders[1].price = (self.order_chunk12 % POW64) as u64;
            orderbook.sell_orders[1].timestamp = (self.order_chunk12 / POW64) as u64;

            orderbook.sell_orders[2].order_id = self.order_chunk13 as u64;
            orderbook.sell_orders[2].amount = (self.order_chunk13 / POW64) as u64;
            orderbook.sell_orders[2].price = (self.order_chunk14 % POW64) as u64;
            orderbook.sell_orders[2].timestamp = (self.order_chunk14 / POW64) as u64;

            orderbook.sell_orders[3].order_id = self.order_chunk15 as u64;
            orderbook.sell_orders[3].amount = (self.order_chunk15 / POW64) as u64;
            orderbook.sell_orders[3].price = (self.order_chunk16 % POW64) as u64;
            orderbook.sell_orders[3].timestamp = (self.order_chunk16 / POW64) as u64;

            for i in 0..MAX_ORDERS {
                orderbook.buy_orders[i].order_type = (self.order_type_chunk / POWS_OF_256[i]) as u8;
            }
            for i in 0..MAX_ORDERS {
                orderbook.sell_orders[i].order_type = (self.order_type_chunk / POWS_OF_256[i]) as u8;
            }

            // TODO: add logic to handle buy and sell conunts
            // orderbook.buy_count = self.order_count as u8;
            // orderbook.sell_count = (self.order_count / 256) as u8;
            orderbook
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
    pub fn init_order_book(mxe: Mxe) -> Enc<Mxe, OrderBookFlat> {
        let order_book = OrderBook::new();
        let order_book_flat = OrderBookFlat::from_orderbook(order_book);
        mxe.from_arcis(order_book_flat)
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
        user_ledger: Enc<Shared, &Balances>,               // Shared
        orderbook_ctx: Enc<Mxe, &OrderBookFlat>,            // MXE
        order_id: u64,
        order_type: u8,
        timestamp: u64,
    ) -> (
        Enc<Mxe, OrderBookFlat>,      // Updated orderbook
        Enc<Shared, Balances>,       // Updated ledger
        Enc<Shared, OrderStatus>, // For user to view
        bool,                     // Success
    ) {
        let sensitive = user_sensitive.to_arcis();
        let mut ledger = *(user_ledger.to_arcis());
        let mut orderbook_flat = *(orderbook_ctx.to_arcis());

        let mut orderbook = OrderBookFlat::to_orderbook(orderbook_flat);

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
        if order_type == 1 {
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
            orderbook_ctx.owner.from_arcis(OrderBookFlat::from_orderbook(orderbook)),
            user_ledger.owner.from_arcis(ledger),
            user_sensitive.owner.from_arcis(status),
            success.reveal(),
        )
    }

    #[instruction]
    pub fn match_orders(
        clanker_authority: Shared,
        order_book_ctxt: Enc<Mxe, OrderBookFlat>,
    ) -> (Enc<Mxe, OrderBookFlat>, Enc<Shared, MatchResult>, u8) {
        let mut orderbook_flat = order_book_ctxt.to_arcis();
        let mut order_book = OrderBookFlat::to_orderbook(orderbook_flat);

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
            order_book_ctxt.owner.from_arcis(OrderBookFlat::from_orderbook(order_book)),
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

    #[instruction]
    pub fn execute_settlement(
        user1_ledger: Enc<Shared, &Balances>,
        user2_ledger: Enc<Shared, &Balances>,
        execution_price: u64,
        is_base: u8,
    ) -> (
        Enc<Shared, Balances>,
        Enc<Shared, Balances>,
    ) {
        let mut user1_balances = *(user1_ledger.to_arcis());
        let mut user2_balances = *(user2_ledger.to_arcis());

        if is_base == 0 {
            user1_balances.base_available -= execution_price;
            user2_balances.base_available += execution_price;
        } else {
            user1_balances.quote_available -= execution_price;
            user2_balances.quote_available += execution_price;
        }

        (
            user1_ledger.owner.from_arcis(user1_balances), 
            user2_ledger.owner.from_arcis(user2_balances)
        )
    }
}
