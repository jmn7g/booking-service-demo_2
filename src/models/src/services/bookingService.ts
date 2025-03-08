import { v4 as uuidv4 } from 'uuid';
import { Booking, BookingStatus } from '../models/booking';
import { PaymentService } from './paymentService';
import { InventoryService } from './inventoryService';
import { NotificationService } from './notificationService';

export class BookingService {
  private bookings: Map<string, Booking> = new Map();
  private paymentService: PaymentService;
  private inventoryService: InventoryService;
  private notificationService: NotificationService;

  constructor(
    paymentService: PaymentService,
    inventoryService: InventoryService,
    notificationService: NotificationService
  ) {
    this.paymentService = paymentService;
    this.inventoryService = inventoryService;
    this.notificationService = notificationService;
  }

  async createBooking(
    userId: string,
    itemId: string,
    startDate: Date,
    endDate: Date,
    totalPrice: number
  ): Promise<Booking> {
    // Check if dates are valid
    if (startDate >= endDate) {
      throw new Error('Start date must be before end date');
    }

    // Check if item is available
    const isAvailable = await this.inventoryService.checkAvailability(
      itemId,
      startDate,
      endDate
    );
    if (!isAvailable) {
      throw new Error('Item is not available for the selected dates');
    }

    // Create booking
    const booking: Booking = {
      id: uuidv4(),
      userId,
      itemId,
      startDate,
      endDate,
      totalPrice,
      status: BookingStatus.PENDING,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Save booking
    this.bookings.set(booking.id, booking);

    // Send notification
    await this.notificationService.sendBookingCreatedNotification(
      userId,
      booking.id
    );

    return booking;
  }

  async confirmBooking(bookingId: string, paymentMethod: string): Promise<Booking> {
    const booking = this.bookings.get(bookingId);
    if (!booking) {
      throw new Error('Booking not found');
    }

    if (booking.status !== BookingStatus.PENDING) {
      throw new Error('Booking cannot be confirmed');
    }

    // Process payment
    const paymentId = await this.paymentService.processPayment(
      booking.userId,
      booking.totalPrice,
      paymentMethod
    );

    // Reserve inventory
    await this.inventoryService.reserveItem(
      booking.itemId,
      booking.startDate,
      booking.endDate
    );

    // Update booking
    booking.status = BookingStatus.CONFIRMED;
    booking.paymentId = paymentId;
    booking.updatedAt = new Date();
    this.bookings.set(bookingId, booking);

    // Send confirmation notification
    await this.notificationService.sendBookingConfirmedNotification(
      booking.userId,
      bookingId
    );

    return booking;
  }

  async cancelBooking(bookingId: string): Promise<Booking> {
    const booking = this.bookings.get(bookingId);
    if (!booking) {
      throw new Error('Booking not found');
    }

    if (booking.status !== BookingStatus.PENDING && booking.status !== BookingStatus.CONFIRMED) {
      throw new Error('Booking cannot be cancelled');
    }

    // If payment was processed, refund
    if (booking.paymentId) {
      await this.paymentService.refundPayment(booking.paymentId);
    }

    // Release inventory
    if (booking.status === BookingStatus.CONFIRMED) {
      await this.inventoryService.releaseItem(
        booking.itemId,
        booking.startDate,
        booking.endDate
      );
    }

    // Update booking
    booking.status = BookingStatus.CANCELLED;
    booking.updatedAt = new Date();
    this.bookings.set(bookingId, booking);

    // Send cancellation notification
    await this.notificationService.sendBookingCancelledNotification(
      booking.userId,
      bookingId
    );

    return booking;
  }

  async completeBooking(bookingId: string): Promise<Booking> {
    const booking = this.bookings.get(bookingId);
    if (!booking) {
      throw new Error('Booking not found');
    }

    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new Error('Booking cannot be completed');
    }

    // Check if end date has passed
    const currentDate = new Date();
    if (currentDate < booking.endDate) {
      throw new Error('Booking end date has not passed yet');
    }

    // Update booking
    booking.status = BookingStatus.COMPLETED;
    booking.updatedAt = new Date();
    this.bookings.set(bookingId, booking);

    // Send completion notification
    await this.notificationService.sendBookingCompletedNotification(
      booking.userId,
      bookingId
    );

    return booking;
  }

  getBooking(bookingId: string): Booking | undefined {
    return this.bookings.get(bookingId);
  }

  getBookingsByUser(userId: string): Booking[] {
    return Array.from(this.bookings.values()).filter(
      booking => booking.userId === userId
    );
  }

  getBookingsByItem(itemId: string): Booking[] {
    return Array.from(this.bookings.values()).filter(
      booking => booking.itemId === itemId
    );
  }

  getActiveBookingsByItem(itemId: string): Booking[] {
    const activeStatuses = [BookingStatus.PENDING, BookingStatus.CONFIRMED];
    return Array.from(this.bookings.values()).filter(
      booking => booking.itemId === itemId && activeStatuses.includes(booking.status)
    );
  }
}
