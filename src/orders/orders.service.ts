import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { PrismaClient } from '@prisma/client';

import { ClientProxy, RpcException } from '@nestjs/microservices';
import { OrderPaginationDto } from './dto/order-pagination.dto';
import { ChangeOrderStatusDto } from './dto';
import { PRODUCT_SERVICE } from 'src/config';
import { firstValueFrom } from 'rxjs';
import { isNotEmpty } from 'class-validator';

@Injectable()
export class OrdersService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger('OrdersService');

  constructor(
    @Inject(PRODUCT_SERVICE) private readonly productsClient: ClientProxy,
  ) {
    super();
  }
  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected');
  }

  async create(createOrderDto: CreateOrderDto) {
    try {
      //1 confirmar los ids de los productos
      const productIds = createOrderDto.items.map((item) => item.productId);

      const products: any[] = await firstValueFrom(
        this.productsClient.send({ cmd: 'validate_products' }, productIds),
      );

      //2 calculos de los valores
      const totalAmount = createOrderDto.items.reduce((acc, OrderItem) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const price = products.find(
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          (product) => product.id === OrderItem.productId,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        ).price;

        return price * OrderItem.quantity;
      }, 0);

      const totalItems = createOrderDto.items.reduce((acc, OrderItem) => {
        return acc * OrderItem.quantity;
      }, 0);

      //3 Crear una transacion de la base datos

      const order = await this.order.create({
        data: {
          totalAmount: totalAmount,
          totalItems: totalItems,
          OrderItem: {
            createMany: {
              data: [],
            },
          },
        },
      });

      return order;
    } catch (error) {
      throw new RpcException({
        status: HttpStatus.BAD_REQUEST,
        message: 'Check logs',
      });
    }

    /* return {
      service: 'Orders Microservice',
      createOrderDto: createOrderDto,
    };*/
    /*return await this.order.create({
      data: createOrderDto,
    });*/
  }

  async findAll(orderPaginationDto: OrderPaginationDto) {
    const totalPages = await this.order.count({
      where: {
        status: orderPaginationDto.status,
      },
    });

    const currentPage = orderPaginationDto.page;
    const perPage = orderPaginationDto.limit;

    return {
      data: await this.order.findMany({
        skip: (currentPage - 1) * perPage,
        take: perPage,
        where: {
          status: orderPaginationDto.status,
        },
      }),
      meta: {
        total: totalPages,
        page: currentPage,
        lastPage: Math.ceil(totalPages / perPage),
      },
    };
  }

  async findOne(id: string) {
    const order = await this.order.findFirst({
      where: { id },
    });

    if (!order) {
      throw new RpcException({
        status: HttpStatus.NOT_FOUND,
        message: `Order with id ${id} not found`,
      });
    }

    return order;
  }

  async changeStatus(changeOrderStatus: ChangeOrderStatusDto) {
    const { id, status } = changeOrderStatus;

    const order = await this.findOne(id);

    if (order.status === status) {
      return order;
    }
    return this.order.update({
      where: { id },
      data: { status: status },
    });
  }
}
