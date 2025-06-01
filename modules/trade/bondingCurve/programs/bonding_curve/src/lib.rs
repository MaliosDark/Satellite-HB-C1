// File: modules/trade/bondingCurve/programs/bonding_curve/src/lib.rs

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, MintTo, Burn};

declare_id!("2eoCVVq7AAavNFUvZrHdY3KP8DeX1QEDZDJQC8UQ78ms");

#[program]
pub mod bonding_curve {
    use super::*;

    /// Initializes a new bonding‐curve “pool” for a specific SPL‐mint,
    /// and stores an off‐chain metadata URI.
    pub fn initialize(
        ctx: Context<Initialize>,
        base_price: u64,
        slope: u64,
        metadata_uri: String,
    ) -> Result<()> {
        let state = &mut ctx.accounts.state;
        state.mint = ctx.accounts.mint.key();
        state.reserve = 0;
        state.supply = 0;
        state.base_price = base_price;
        state.slope = slope;
        state.metadata_uri = metadata_uri;
        Ok(())
    }

    /// Buys `amount` tokens of the mint that this “pool” manages.
    pub fn buy(ctx: Context<Trade>, amount: u64) -> Result<()> {
        let state = &mut ctx.accounts.state;
        let old_supply = state.supply;
        let new_supply = old_supply.checked_add(amount).unwrap();

        // cost = amount * base_price
        //      + slope * (amount*old_supply + amount*(amount-1)/2)
        let base_cost = amount.checked_mul(state.base_price).unwrap();
        let part1 = amount.checked_mul(old_supply).unwrap();
        let part2 = amount
            .checked_mul(amount.checked_sub(1).unwrap())
            .unwrap()
            .checked_div(2)
            .unwrap();
        let slope_cost = state
            .slope
            .checked_mul(part1.checked_add(part2).unwrap())
            .unwrap();
        let cost = base_cost.checked_add(slope_cost).unwrap();

        // Transfer lamports from user to reserve PDA
        **ctx
            .accounts
            .user
            .to_account_info()
            .try_borrow_mut_lamports()? = ctx
            .accounts
            .user
            .lamports()
            .checked_sub(cost)
            .unwrap();
        **ctx
            .accounts
            .reserve
            .to_account_info()
            .try_borrow_mut_lamports()? = ctx
            .accounts
            .reserve
            .lamports()
            .checked_add(cost)
            .unwrap();

        // Mint `amount` tokens to user's token account
        let cpi_accounts = MintTo {
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx
                .accounts
                .user_token_account
                .to_account_info(),
            authority: ctx.accounts.mint_authority.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();

        // PDA seeds: ["mint-authority", mint, bump]
        let bump = *ctx.bumps.get("mint_authority").unwrap();
        let bump_slice: &[u8] = &[bump];
        let mint_key = ctx.accounts.mint.key();

        let seeds: &[&[u8]] = &[
            b"mint-authority",
            mint_key.as_ref(),
            bump_slice,
        ];
        let signer: &[&[&[u8]]] = &[&seeds];

        token::mint_to(
            CpiContext::new_with_signer(cpi_program, cpi_accounts, signer),
            amount,
        )?;

        state.supply = new_supply;
        state.reserve = state.reserve.checked_add(cost).unwrap();
        Ok(())
    }

    /// Sells `amount` tokens of this mint; burns tokens and refunds lamports.
    pub fn sell(ctx: Context<Trade>, amount: u64) -> Result<()> {
        let state = &mut ctx.accounts.state;
        let old_supply = state.supply;
        require!(
            old_supply >= amount,
            CustomError::InsufficientSupply
        );
        let new_supply = old_supply.checked_sub(amount).unwrap();

        // refund = amount * base_price
        //        + slope * (amount*new_supply + amount*(amount-1)/2)
        let base_refund = amount.checked_mul(state.base_price).unwrap();
        let part1 = amount.checked_mul(new_supply).unwrap();
        let part2 = amount
            .checked_mul(amount.checked_sub(1).unwrap())
            .unwrap()
            .checked_div(2)
            .unwrap();
        let slope_refund = state
            .slope
            .checked_mul(part1.checked_add(part2).unwrap())
            .unwrap();
        let refund = base_refund.checked_add(slope_refund).unwrap();

        // Burn `amount` tokens from user's token account
        let cpi_accounts = Burn {
            mint: ctx.accounts.mint.to_account_info(),
            from: ctx
                .accounts
                .user_token_account
                .to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        token::burn(CpiContext::new(cpi_program, cpi_accounts), amount)?;

        // Transfer lamports from reserve PDA back to user
        **ctx
            .accounts
            .reserve
            .to_account_info()
            .try_borrow_mut_lamports()? = ctx
            .accounts
            .reserve
            .lamports()
            .checked_sub(refund)
            .unwrap();
        **ctx
            .accounts
            .user
            .to_account_info()
            .try_borrow_mut_lamports()? = ctx
            .accounts
            .user
            .lamports()
            .checked_add(refund)
            .unwrap();

        state.supply = new_supply;
        state.reserve = state.reserve.checked_sub(refund).unwrap();
        Ok(())
    }
}

/// Accounts for `initialize`:
#[derive(Accounts)]
pub struct Initialize<'info> {
    /// PDA “state” for this mint, with room for a metadata URI string (max 200 bytes)
    #[account(
        init,
        payer = initializer,
        space = 8 + 32 + 8 + 8 + 8 + 8 + 4 + 200,
        seeds = [b"state", mint.key().as_ref()],
        bump
    )]
    pub state: Account<'info, State>,

    /// The SPL mint this curve will manage
    #[account(mut)]
    pub mint: Account<'info, Mint>,

    /// CHECK: PDA mint authority, seeds = ["mint-authority", mint.key()]
    #[account(
        seeds = [b"mint-authority", mint.key().as_ref()],
        bump
    )]
    pub mint_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub initializer: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

/// Accounts for `buy` / `sell`:
#[derive(Accounts)]
pub struct Trade<'info> {
    /// PDA “state” for this mint
    #[account(
        mut,
        seeds = [b"state", mint.key().as_ref()],
        bump
    )]
    pub state: Account<'info, State>,

    #[account(mut)]
    pub user: Signer<'info>,

    /// CHECK: PDA holding lamports as the reserve for this mint
    #[account(
        mut,
        seeds = [b"reserve", mint.key().as_ref()],
        bump
    )]
    pub reserve: UncheckedAccount<'info>,

    /// The SPL mint being traded
    #[account(mut)]
    pub mint: Account<'info, Mint>,

    /// CHECK: PDA mint authority for this mint
    #[account(
        seeds = [b"mint-authority", mint.key().as_ref()],
        bump
    )]
    pub mint_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct State {
    /// The SPL mint address this curve is bound to
    pub mint: Pubkey,
    /// Total lamports stored in the reserve PDA
    pub reserve: u64,
    /// Total supply of tokens minted so far
    pub supply: u64,
    /// Base price per token (in lamports)
    pub base_price: u64,
    /// Slope used in price formula
    pub slope: u64,
    /// Off‐chain metadata URI (max 200 bytes)
    pub metadata_uri: String,
}

#[error_code]
pub enum CustomError {
    #[msg("Not enough tokens in supply to sell.")]
    InsufficientSupply,
}
